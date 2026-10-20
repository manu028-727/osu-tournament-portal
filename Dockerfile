# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22.23.3-trixie-slim@sha256:154ba2f4d6fec323d28e4f4bb86bba4677f1223391a1979cf521304e03a98dfa
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian13:nonroot@sha256:ec2313763dd43931543bd03830466e0c409ce73a487e8d46f10db72d3b816c1c
FROM ${NODE_IMAGE} AS patched-base
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* && npm install --global npm@12.2.0 --no-audit --no-fund

FROM ${RUNTIME_IMAGE} AS runtime-base
ENV PATH=/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER 1000:1000

FROM patched-base AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts/collect-notices.mjs ./scripts/collect-notices.mjs
RUN node scripts/collect-notices.mjs /build/THIRD_PARTY_NOTICES.txt && mkdir -p /build/uploads

FROM dependencies AS builder
COPY . .
# Generation needs a URL, never a reachable database or a build-time secret.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/tournament_platform
RUN npm run build
RUN npx esbuild scripts/serve-container.mjs --bundle --platform=node --format=cjs --outfile=/build/front.cjs

FROM dependencies AS irc-builder
COPY services/irc ./services/irc
COPY src/lib/irc-*.ts ./src/lib/
RUN npx esbuild services/irc/server.ts --bundle --platform=node --format=cjs --external:bufferutil --external:utf-8-validate --outfile=/build/irc.cjs

FROM runtime-base AS irc-gateway
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=irc-builder --chown=1000:1000 /build/irc.cjs ./irc.cjs
COPY --from=dependencies /build/THIRD_PARTY_NOTICES.txt ./THIRD_PARTY_NOTICES.txt
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["irc.cjs"]

FROM dependencies AS tools-source
COPY --chown=node:node . .
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/tournament_platform npx prisma generate && mkdir -p /app/.next && chown node:node /app /app/.next && chown -R node:node /app/src/generated

FROM tools-source AS development
USER node
ENTRYPOINT ["node", "--import", "tsx"]

# Maintenance needs Prisma/TypeScript dependencies, not a shell or package manager.
FROM runtime-base AS tools
WORKDIR /app
ENV HOME=/tmp NEXT_TELEMETRY_DISABLED=1
COPY --from=tools-source --chown=1000:1000 /app ./
COPY --from=dependencies /build/THIRD_PARTY_NOTICES.txt ./THIRD_PARTY_NOTICES.txt
ENTRYPOINT ["/nodejs/bin/node", "--import", "tsx"]

FROM runtime-base AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=1000:1000 /app/.next/standalone ./
COPY --from=builder --chown=1000:1000 /app/.next/static ./.next/static
COPY --from=builder --chown=1000:1000 /app/public ./public
COPY --from=builder --chown=1000:1000 /build/front.cjs ./front.cjs
COPY --from=dependencies /build/THIRD_PARTY_NOTICES.txt ./THIRD_PARTY_NOTICES.txt
COPY --from=dependencies --chown=1000:1000 /build/uploads /var/lib/tournament/uploads
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["front.cjs"]
