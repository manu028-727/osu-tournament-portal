-- A removed fixture keeps its node and number but no longer produces progression.
ALTER TABLE "BracketNode"
  DROP CONSTRAINT "BracketNode_state_check",
  ADD CONSTRAINT "BracketNode_state_check"
    CHECK ("state" IN ('WAITING', 'READY', 'BYE', 'COMPLETED', 'SKIPPED', 'DELETED'));
