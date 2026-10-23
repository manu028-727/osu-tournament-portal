# Tournament Match Numbers

Every persisted match has a positive, tournament-scoped `matchNumber`, separate from its internal database ID and source `code`. The database enforces uniqueness on `(tournamentId, matchNumber)`. A PostgreSQL insert trigger allocates numbers for direct and legacy application inserts; the tournament counter row serializes concurrent allocations. Match numbers are immutable after creation and are never recycled after deletion.

## Manual and imported matches

Manual match creation uses a numeric `code` as the requested match number when that number is above the tournament's allocated high-water mark. Otherwise, numeric collisions are rejected for explicit resolution. Nonnumeric codes receive the next number while retaining the original code. Historical workbook imports follow the same rule: an available numeric source identifier is preserved; a conflicting identifier is reported in preview and the import is rejected until resolved. Batch imports run in worksheet-number order.

## Generated brackets

At bracket creation, the service reserves a consecutive number range for every node that can become a played match. `BYE` and `SKIPPED` nodes do not consume numbers. It orders the range by configured `BracketRound.position`, lane, then node position and stable key. The generated engine's round position defines the progression order for winners, losers, finals, and group rounds. Multiple brackets use creation transaction order; each new bracket receives the next range after all numbers already allocated or reserved in that tournament.

Each playable `BracketNode` stores its reserved `matchNumber`. The number is copied to its Match when the lazy bracket workflow materializes the fixture, so later rounds retain their position-based numbers even if unrelated matches are created before they become playable. Rescheduling, progression, result correction, visual layout changes, and deletion do not renumber matches.

## Existing data and consumer contract

The migration preserves unambiguous positive numeric match codes. Duplicate numeric spellings and nonnumeric codes retain their original source `code` and receive distinct numbers in creation order. Existing bracket matches inherit their match number; unmaterialized playable nodes reserve numbers after historical matches, ordered by bracket creation and configured round/position. No match IDs, actions, scores, or results are rewritten.

UI/API consumers should display `MatchSummary.matchNumber` and `CompetitionNode.matchNumber` as `Match N`. `CompetitionMatch.matchNumber` carries the same value when the node has materialized. Match search accepts the number as well as the existing code and team names. Public numeric URLs identify only `matchNumber`; nonnumeric source-code URLs and internal-ID organizer links remain valid. Numeric legacy codes cannot shadow a different match's stable number.

Because tournament numbers are now assigned by the database trigger, production schema deployment must apply this migration before starting code generated from the updated Prisma schema.

## Build a bracket from existing match history

1. Open **Matches**, switch to **Bracket**, and select **Create bracket**.
2. Choose the actual bracket format and seed order. Enable **Link existing matches**.
3. Preview the bracket and assign the correct gameplay stage to each round before generating it. This mode creates positions without creating replacement matches or allocating new match numbers.
4. Starting with the earliest round, open a ready position and choose its existing match. Candidates must belong to the same tournament and stage and contain the same two participants. A reversed red/blue order is identified explicitly; linking swaps the bracket's incoming sides while preserving the match's original sides and actions.
5. Click **Link existing match**. Completed results resolve the following positions. Repeat through the played rounds, then link the existing scheduled Grand Finals fixtures when their participants are resolved.
6. Referee and confirm the linked upcoming match normally. The bracket advances from that same Match record.

Existing match numbers, multiplayer links, player scores, actions, and result history remain in their original records. A match can occupy only one bracket position. Version checks reject stale links, and protected downstream matches require reconciliation rather than replacement. **Round stages** can assign a stage to multiple unstarted rounds; rounds containing operational history cannot be reassigned.

Tournament exports now include match numbers, bracket reservations, and the allocation counter. Older archives without these fields keep unambiguous numeric source codes when possible, and receive safe new numbers for the remaining records during import.
