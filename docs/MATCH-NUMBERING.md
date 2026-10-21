# Tournament Match Numbers

Every persisted match has a positive, tournament-scoped `matchNumber`, separate from its internal database ID and source `code`. The database enforces uniqueness on `(tournamentId, matchNumber)`. A PostgreSQL insert trigger allocates numbers for direct and legacy application inserts; the tournament counter row serializes concurrent allocations. Match numbers are immutable after creation and are never recycled after deletion.

## Manual and imported matches

Manual match creation uses a numeric `code` as the requested match number when that number is above the tournament's allocated high-water mark. Otherwise, numeric collisions are rejected for explicit resolution. Nonnumeric codes receive the next number while retaining the original code. Historical workbook imports follow the same rule: an available numeric source identifier is preserved; a conflicting identifier is reported in preview and the import is rejected until resolved. Batch imports run in worksheet-number order.

## Generated brackets

At bracket creation, the service reserves a consecutive number range for every node that can become a played match. `BYE` and `SKIPPED` nodes do not consume numbers. It orders the range by configured `BracketRound.position`, lane, then node position and stable key. The generated engine's round position defines the progression order for winners, losers, finals, and group rounds. Multiple brackets use creation transaction order; each new bracket receives the next range after all numbers already allocated or reserved in that tournament.

Each playable `BracketNode` stores its reserved `matchNumber`. The number is copied to its Match when the lazy bracket workflow materializes the fixture, so later rounds retain their position-based numbers even if unrelated matches are created before they become playable. Rescheduling, progression, result correction, visual layout changes, and deletion do not renumber matches.

## Existing data and consumer contract

The migration preserves unambiguous positive numeric match codes. Duplicate numeric spellings and nonnumeric codes retain their original source `code` and receive distinct numbers in creation order. Existing bracket matches inherit their match number; unmaterialized playable nodes reserve numbers after historical matches, ordered by bracket creation and configured round/position. No match IDs, actions, scores, or results are rewritten.

UI/API consumers should display `MatchSummary.matchNumber` and `CompetitionNode.matchNumber` as `Match N`. `CompetitionMatch.matchNumber` carries the same value when the node has materialized. Match search accepts the number as well as the existing code and team names. Existing code and internal-ID deep links remain valid.

Because tournament numbers are now assigned by the database trigger, production schema deployment must apply this migration before starting code generated from the updated Prisma schema.
