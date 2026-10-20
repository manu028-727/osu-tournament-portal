<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Docker Network Safety

- Before creating staging networks, inspect Docker's effective address pools,
  host routes, SSH client address and routed LAN/VPN ranges. Docker defaults can
  allocate `192.168.x.x`; never assume they only allocate `172.x.x`.
- Do not start additional stacks with unreviewed address pools. Changing daemon
  settings does not renumber existing networks; do not restart the daemon casually.
- Keep temporary stacks bounded and remove only task-owned test containers and
  networks after verification. Preserve named volumes, backups and live services.
- Never use global pruning or `down --volumes` to repair a network conflict.
