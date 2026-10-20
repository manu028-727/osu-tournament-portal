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
command is not a confirmed execution: only creation, settings and beatmap responses
currently have positive acknowledgement parsers. Other outcomes may stay unknown.
No IRC command automatically confirms a recorded map winner.

Buffers, sessions, message lengths, queues and rates are bounded. Chat/receipts are
ephemeral; linked URLs, creation guards and recorded referee history persist. One
gateway instance is supported; horizontal sharding is not implemented.

Automated tests use mock TCP Bancho and the actual HTTPS/WSS transport. Live Bancho
credentials/rooms are not verified. Real tests require explicit disposable-room
authorization; never test disruptive commands against active tournament matches.
