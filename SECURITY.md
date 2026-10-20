# Security

Do not report credentials, IRC passwords, player contacts or private tournament
records in a public issue. Report vulnerabilities privately through the
repository's [Security tab](https://github.com/manu028-727/osu-tournament-portal/security).

Include affected version, minimal synthetic reproduction, impact and remediation
ideas. Do not test destructive operations against running tournaments. Rotate
suspected exposed credentials through the operator, never automatically.

Production requires HTTPS, a trusted operator, private database/storage networks,
scoped S3 credentials, secure cookies, verified OAuth callbacks and protected
environment files. Secrets never belong in NEXT_PUBLIC variables, build arguments,
URLs, issue attachments or logs. IRC has a separate explicit plaintext-network
warning and is disabled by default.

Back up independently, review dependency/storage advisories and use least-privilege
runtime accounts. Only designated, one-time owner bootstrap is permitted. Global
and local permissions, media ownership and WebSocket session scope are checked on
the server. New installations contain no privileged test/login endpoint.
