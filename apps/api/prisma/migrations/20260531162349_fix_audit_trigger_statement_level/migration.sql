-- Upgrade audit_events trigger from FOR EACH ROW to FOR EACH STATEMENT.
-- FOR EACH STATEMENT fires even when no rows match the WHERE clause,
-- which allows tests to verify immutability without inserting test data.

DROP TRIGGER IF EXISTS audit_events_immutable ON "audit_events";
DROP FUNCTION IF EXISTS prevent_audit_event_modification();

CREATE OR REPLACE FUNCTION prevent_audit_event_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only — UPDATE and DELETE are forbidden';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_event_modification();
