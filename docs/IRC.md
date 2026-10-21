# Optional Bancho IRC

Set IRC_ENABLED=true and include `irc` in COMPOSE_PROFILES. Build/start irc-gateway
with web. Keep IRC_GATEWAY_SECRET identical and private. Existing HTTPS proxying
must allow WebSocket upgrades to web; do not publish the gateway port.

In a match, open Bancho IRC, read the warning, acknowledge it and enter the separate
IRC password from osu! account settings. **Do not enter your ordinary password.**
The [official IRC documentation](https://osu.ppy.sh/wiki/en/Community/Internet_Relay_Chat)
specifies irc.ppy.sh:6667 without TLS. HTTPS/WSS protects the browser hop only;
the hosting operator and network observers may access plaintext Bancho traffic.

Existing OAuth sessions issue short-lived single-use user/session/tournament/match
tickets. Signed internal calls reauthorize permissions and assignment on every
operation; stored nonces reject RPC replay. Observe and edit are distinct. Users
cannot send via another referee's connection. Bancho room permissions still apply.

Passwords stay temporarily in memory; browser inputs and IRC-library references
are cleared after use. They are not logged or stored in PostgreSQL/S3/browser
storage. JavaScript cannot guarantee forensic memory zeroization. No automatic
reconnect with saved passwords. Closing tabs disconnects after a short grace;
restart needs password reentry. Disconnect never sends a room-close command.

Registration joins #osu. BanchoBot, lobby chat and player PMs have separate tabs.
Lobby creation sends !mp make privately to BanchoBot, parses an actual official room
URL, joins its channel and requires explicit linking to the website match. Existing
links can be joined. Unresolved creation is persisted before sending; unknown
outcomes block blind retries across restarts. Inspect rooms/BanchoBot before
explicitly resolving a request. Creation/linking never creates a website match.

Map/mods/rules/invite/timer/start/settings and other approved commands use the
existing referee configuration. Start/abort/close and other disruptive operations
require confirmation. Creator-only addref needs persisted creation proof. A sent
command is not a confirmed execution: creation, settings, beatmap changes, mod
settings, timers and referee lists have positive acknowledgement parsers. Other
outcomes may stay unknown.
No IRC command automatically confirms a recorded map winner.

### Command Acknowledgements

The gateway accepts receipts only from BanchoBot in the pending command's own
destination. Beatmap replies support both `Changed beatmap to` and the older
`Beatmap changed to:` wording, and must contain the exact requested beatmap ID on
osu.ppy.sh. Mod replies must match the requested mod combination (short names such
as NF/HD are matched against NoFail/Hidden) and FreeMod state. Timer replies must
report the requested duration, including minutes and seconds; later countdown
reminders are not generic success receipts. `Match referees:` acknowledges
`!mp listrefs`; all following names still appear in chat.

A recognized reply confirms the receipt immediately, cancels the outcome timer
and releases the per-lobby command lock across the user's tabs. Explicit rejection
replies fail immediately. Unknown responses still time out honestly, without
resending commands or treating arbitrary bot chatter as success. Bancho does not
include request IDs: identical commands issued concurrently by other clients in
the same lobby cannot be distinguished. This gateway permits only one outstanding
command per destination and never retries automatically.

Regression tests replay the reported settings, timer, listrefs, map and mods chat
sequence against a mock TCP server, checking immediate release, cross-tab receipts,
exactly-once sends, timer cancellation, explicit failures and negative cases for
wrong IDs/mods/durations, spoofed senders and cross-lobby/private replies. These are
mock-server tests; no commands are executed against live tournament rooms.

Buffers, sessions, message lengths, queues and rates are bounded. Chat/receipts are
ephemeral; linked URLs, creation guards and recorded referee history persist. One
gateway instance is supported; horizontal sharding is not implemented.

## Registration and Safe Diagnostics

The gateway reauthorizes the signed-in referee's identity before connecting. It
uses the current username returned by the website, replacing spaces with
underscores for both nickname and username. Stale identity tickets require a
refresh; the gateway never substitutes an organizer account or configured bot.
If the osu! account was renamed since the last OAuth login, sign in again to
refresh the website profile first.

The Bancho-specific `irc-framework` subclass sends `PASS`, then `NICK`, then
`USER <nickname> 0 * :<nickname>`, using CRLF framing. It does not send the generic
client's initial `CAP LS 302` or negotiate SASL/NickServ. The original generic
registration plus the gateway's catch-all login-error handler reproduced a false
password failure when a strict mock rejected CAP with 421. The previous mock
accepted CAP, so it did not exercise this compatibility failure.
This establishes a reproducible gateway bug, not the exact response from a
particular live deployment: the no-credential Bancho capability probe from this
development host timed out. No real user password was requested or tested.
Use the new safe upstream code to diagnose any remaining live rejection.

Passwords are passed verbatim through JSON/WebSocket and the IRC parameter
encoder, without trimming, hashing, URL decoding or Base64 encoding. Validation
requires 1-200 printable ASCII characters without spaces or control characters.
Invalid input is rejected explicitly; it is never silently shortened to fit the
limit. A single IRC trailing-parameter colon, when needed, is framing and is not
part of the password. Password fields disable autocapitalization/correction and
are cleared after submission.

The match panel shows a connection error with nickname, stage, source and code.
Gateway stdout emits structured `irc.connection` events containing only those
same fields. It never prints raw IRC traffic, server error reasons, passwords,
authentication commands, tickets or website session hashes. Pre-registration
notices are not forwarded into the chat history.

Interpret `source` before assuming the password is wrong:

- `gateway`, `validation`, `INVALID_CONNECT_REQUEST`: local validation rejected
  the request; no IRC connection was attempted.
- `gateway`, `identity`, `USERNAME_CHANGED` or `NICKNAME_MISMATCH`: the identity
  must be refreshed or did not match the server welcome; no alternate nickname
  is tried.
- `transport`, `connecting` or `registration`: socket failure or timeout, not a
  confirmed password rejection.
- `bancho`, `registration`, `464`: the upstream IRC server rejected authentication.
- `bancho`, `registration`, `432`/`433`: nickname rejection/collision.
- `bancho`, `registration`, `421`/`461`: command/registration compatibility failure.
- `bancho`, `ERROR`: the upstream server ended the connection. This alone does
  not prove a wrong password; the raw reason is deliberately not retained.
- `bancho`, `connected`, `001`: successful registration, followed by joining `#osu`.

Inspect safe diagnostics using `./portal compose logs --tail=100 irc-gateway`.
Rebuild/recreate the gateway after updating its source, and rebuild web for the
password-input change; starting an existing image alone does not apply the fix:

```bash
./portal compose build web irc-gateway
./portal compose up -d web irc-gateway
```

Mock TCP tests verify the exact command order/USER format, special-character and
200-character password fidelity, stale usernames, user isolation, local rejection,
upstream numerics/ERROR, transport failures, and secret-free diagnostics. An opt-in
browser test in `tests/e2e/referee.spec.ts` exercises real website ticket issuance,
signed authorization RPC and WebSocket delivery to the strict mock. Run it with
`IRC_ENABLED=true` and a temporary, test-only `IRC_GATEWAY_SECRET` of at least 64
characters in the isolated E2E environment. Never use real IRC passwords in tests.

Verification for this fix: the strict registration test failed against the old
gateway and passed after the change. All **163 unit tests** (including **19 IRC
tests**), **63 database integration tests**, and **7 referee browser tests** passed.
The production Next.js build, gateway esbuild bundle, TypeScript, lint, formatting
and changed-source secret scan also passed. The browser test uses loopback HTTP/WS
and mock Bancho, not real user credentials or the live tournament database. No
Docker networks, production services or database migrations were changed.

Automated tests use mock TCP Bancho and the actual HTTPS/WSS transport. Live Bancho
credentials/rooms are not verified. Real tests require explicit disposable-room
authorization; never test disruptive commands against active tournament matches.
