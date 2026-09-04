-- Serialize active AutomationRun inserts per definition so SKIP_IF_RUNNING
-- remains correct when different request keys start concurrently.
CREATE OR REPLACE FUNCTION enforce_automation_skip_if_running_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_run_id uuid;
BEGIN
  IF NEW.status = 'QUEUED'
     AND EXISTS (
       SELECT 1
       FROM "AutomationDefinition"
       WHERE id = NEW."definitionId"
         AND "overlapPolicy" = 'SKIP_IF_RUNNING'
     )
  THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW."definitionId"::text, 0)
    );

    SELECT id
    INTO active_run_id
    FROM "AutomationRun"
    WHERE "definitionId" = NEW."definitionId"
      AND status IN ('QUEUED', 'RUNNING')
    ORDER BY "createdAt" ASC, id ASC
    LIMIT 1;

    IF active_run_id IS NOT NULL THEN
      NEW.status := 'SKIPPED';
      NEW."deadlineAt" := NULL;
      NEW."blockedByRunId" := active_run_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS automation_run_skip_if_running_insert
ON "AutomationRun";

CREATE TRIGGER automation_run_skip_if_running_insert
BEFORE INSERT ON "AutomationRun"
FOR EACH ROW
EXECUTE FUNCTION enforce_automation_skip_if_running_insert();
