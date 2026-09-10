ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'CONTENT_DRAFT_PURGED';

CREATE OR REPLACE FUNCTION "reject_p8_immutable_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'ContentDraftVersion'
     AND TG_OP = 'DELETE'
     AND current_setting('seogeo.allow_content_draft_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'P8 immutable row % cannot be updated or deleted', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
