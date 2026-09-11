# Main-Site Schema Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply validated SEO GEO JSON-LD to the existing 兴善堂主站草稿 and emit it only after that article is published.

**Architecture:** 兴善堂主站 owns `schemaJson` on its article record and exposes a signed draft-only update endpoint. SEO GEO owns the candidate editor and calls that endpoint only for an existing recorded main-site draft sync, so Schema sync never creates another article.

**Tech Stack:** Node.js, Express, JSON-file article repository, EJS, Prisma, TypeScript, Vitest, Supertest, HMAC-SHA256.

**Spec:** `docs/superpowers/specs/2026-09-11-main-site-schema-sync-design.md`

## Global Constraints

- Only a `draft` main-site article may accept a Schema update.
- JSON-LD must be an object with Schema.org `@context` and non-empty `@type`.
- Schema sync must not change article body, section, status, publication date, or create a new article.
- Main-site JSON-LD renders only for published public detail pages and escapes `<` during serialization.
- Fail closed on invalid Schema, missing sync record, changed main-site status, signature failure, or transport failure.

---

### Task 1: Main-site schema persistence and public output

**Files:**
- Modify: `/var/www/xingshantang/current/server/db/repositories/articles.js`
- Modify: `/var/www/xingshantang/current/server/routes/api-articles.js`
- Modify: `/var/www/xingshantang/current/server/views/site/article.ejs`
- Test: `/var/www/xingshantang/current/tests/http/api-articles.test.js`

**Interfaces:**
- Produces `article.schemaJson: object | null`.
- Produces `PUT /api/v1/articles/:id/schema` with `{ schemaJson }` and a `{ article }` draft response.

- [ ] **Step 1: Write failing tests** for a draft-only Schema update, published-article rejection, invalid JSON-LD rejection, and escaped published-page output.
- [ ] **Step 2: Run the focused main-site test file** and confirm each new assertion fails before implementation.
- [ ] **Step 3: Add `schemaJson: input.schemaJson || null` to article creation and repository update handling.**
- [ ] **Step 4: Add `validateSchemaJson` in `api-articles.js` and implement `PUT /:id/schema`; reject absent/deleted with 404, non-draft with 409, malformed JSON-LD with 400; snapshot then persist only `schemaJson`.**
- [ ] **Step 5: In `article.ejs`, conditionally render `<script type="application/ld+json">` only when `article.status === 'published'`; serialize with `JSON.stringify(schemaJson).replaceAll('<', '\\u003c')`.**
- [ ] **Step 6: Re-run focused tests and `npm test`; reload PM2 only after HTTP checks are green.**
- [ ] **Step 7: Commit** with `feat: support schema on main-site draft articles`.

### Task 2: SEO GEO Schema candidate editor and signed client update

**Files:**
- Modify: `src/modules/publication/xingshantang-cms.client.ts`
- Modify: `src/modules/publication/main-site-draft-sync.service.ts`
- Modify: `src/modules/publication/publication.web.routes.ts`
- Modify: `src/views/publication/editor.ejs`
- Create: `src/views/publication/schema-editor.ejs`
- Test: `tests/unit/xingshantang-cms.client.test.ts`
- Test: `tests/integration/main-site-draft-sync.service.test.ts`

**Interfaces:**
- Consumes `schemaJson` from the current `ContentDraft` and `MainSiteDraftSync.mainArticleId`.
- Produces `XingshantangCmsClient.updateDraftSchema({ articleId, schemaJson })`.

- [ ] **Step 1: Write failing client tests** asserting HMAC-signed `PUT /api/v1/articles/{id}/schema`, JSON body preservation, and a nonretryable 409 error.
- [ ] **Step 2: Run that focused test file** and confirm it fails because `updateDraftSchema` is missing.
- [ ] **Step 3: Implement `updateDraftSchema` using the same canonical signing, timeout, and response validation as `createDraft`; include no title/body/status fields.**
- [ ] **Step 4: Write failing service tests** for missing existing sync rejection and successful update using the stored main article ID.
- [ ] **Step 5: Implement `syncSchemaToExistingMainSiteDraft`, requiring valid JSON-LD and the current-version sync record. Do not create `MainSiteDraftSync` records.**
- [ ] **Step 6: Add GET/POST schema editor routes with CSRF and `CONTENT_WRITE`; saving validates JSON then calls `saveDraftVersion` to create a new reviewed version; sync action is separate.**
- [ ] **Step 7: Add editor actions “编辑 Schema” and “同步 Schema 到主站草稿”; show disabled explanatory text for missing Schema or missing main-site sync.**
- [ ] **Step 8: Run the focused unit and integration suites, then `DATABASE_URL='postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder' npm run build`.**
- [ ] **Step 9: Commit** with `feat: apply schema candidates to existing main-site drafts`.

### Task 3: Production verification and safe rollout

**Files:**
- Modify: deployment release directories only; no production data migration is required.

- [ ] **Step 1: Build the SEO GEO image and run it on a new localhost candidate port using the existing runtime environment without printing secrets.**
- [ ] **Step 2: Call candidate `/health/live`, then switch Nginx only after success; retain the current candidate for rollback.**
- [ ] **Step 3: Verify public SEO GEO health and the Schema editor route while authenticated.**
- [ ] **Step 4: Verify main-site draft endpoint with focused tests and public homepage health after PM2 reload.**
- [ ] **Step 5: Report the exact user flow: edit Schema → save a new SEO GEO version → sync to the same main-site draft → publish separately.**
