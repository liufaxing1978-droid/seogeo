# Release-01 PostgreSQL Backup & Restore Runbook

Status: **STAGING OPERATIONS RUNBOOK**  
Scope: operator-controlled Release-01 staging safety  
Production deployment: **NOT AUTHORIZED BY THIS DOCUMENT**

## 1. Purpose

This document defines a repeatable PostgreSQL backup and restore procedure for Release-01 staging. It is designed to prove that the database can be recovered before any future production deployment is considered.

Release-01 uses forward-only Prisma migrations. It does not introduce automatic down-migrations.

## 2. Required record

For every candidate rollout, record together:

- candidate SHA;
- UTC timestamp;
- source staging database identity;
- backup file/snapshot identifier;
- PostgreSQL major version;
- operator identity;
- restore-test target identity;
- restore-test result.

The backup identifier and candidate SHA must be linked in the external release record.

## 3. Backup prerequisites

Before backup:

- confirm the database is the intended staging database;
- confirm sufficient storage exists;
- confirm the backup destination is access-controlled;
- ensure credentials are supplied through the operator environment/secret system and are not written into the repository;
- record the exact candidate SHA about to be migrated.

Do not proceed to migration until the backup has completed successfully.

## 4. Logical backup with pg_dump

For a portable staging proof, use PostgreSQL custom format:

```bash
BACKUP_FILE="seogeo-staging-${CANDIDATE_SHA}-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$BACKUP_FILE" \
  "$DATABASE_URL"
```

Do not print `DATABASE_URL` to logs if it contains credentials.

Validate that the dump can be read:

```bash
pg_restore --list "$BACKUP_FILE" >/dev/null
```

Record file size and a cryptographic checksum in the external release record, for example:

```bash
sha256sum "$BACKUP_FILE"
```

A zero-length file, failed `pg_dump`, or failed `pg_restore --list` blocks migration.

## 5. Platform snapshot alternative

If the staging PostgreSQL provider supplies native snapshots, the operator may use a provider snapshot instead of or in addition to `pg_dump` when it gives equal or stronger recovery guarantees.

Record the provider snapshot ID, database identity, creation timestamp, and candidate SHA. The restore procedure still must be exercised against a **non-production** target before Release-01 closure.

## 6. Restore rehearsal target

Never rehearse restore over the active staging database.

Create a disposable **non-production** PostgreSQL 17 target with no production traffic and no production credentials. The target must be clearly named as a restore rehearsal environment.

Example logical restore flow:

```bash
createdb "$RESTORE_DATABASE_NAME"
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$RESTORE_DATABASE_URL" \
  "$BACKUP_FILE"
```

If the provider requires database creation through its control plane, create the empty restore target there and then run `pg_restore` into that target.

## 7. Restore verification

After restore, verify at minimum:

- connection succeeds;
- Prisma migration history exists and is readable;
- expected application tables exist;
- representative projects/users/memberships and immutable evidence tables are present;
- application readiness can connect to the restored database when pointed to the rehearsal target;
- no real production endpoint is connected to the rehearsal target.

Do not mutate immutable audit/history records merely to prove restore success.

## 8. Migration and rollback relationship

Release-01 treats Prisma migrations as forward migrations:

```bash
npx prisma migrate deploy
```

No automatic down-migrations are created or executed by Release-01.

If an application rollback is compatible with the migrated schema, redeploy the previous known-good application artifact and keep the database forward-migrated.

If the schema/data state is incompatible with rollback, the operator must choose one of two reviewed paths:

1. restore the verified pre-migration backup to an approved recovery target and perform a controlled cutover; or
2. create and review a forward-fix migration.

Do not improvise destructive SQL as an undocumented rollback mechanism.

## 9. Restore decision controls

A restore is an operator decision. The application, Worker, DeepSeek, optimization flows, and publication flows have no authority to initiate database restore.

Before a destructive restore/cutover, confirm:

- incident reason and affected candidate SHA;
- backup identifier and checksum/snapshot ID;
- whether data written after the backup would be lost;
- approval from the responsible operator;
- destination database identity;
- a post-restore validation plan.

## 10. Evidence required for Release-01 closure

The staging acceptance record must include:

- one successful backup associated with the exact candidate SHA;
- one successful restore exercise to a non-production target;
- evidence that the restored target is usable;
- confirmation that no automatic down-migrations were used;
- confirmation that the active staging database was not overwritten during the rehearsal.

Passing this runbook proves recovery procedure readiness only. It does not authorize Production deployment.
