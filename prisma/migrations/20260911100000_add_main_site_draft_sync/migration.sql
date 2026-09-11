CREATE TABLE "MainSiteDraftSync" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "draftId" UUID NOT NULL,
    "draftVersion" INTEGER NOT NULL,
    "mainArticleId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MainSiteDraftSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MainSiteDraftSync_draft_version_key"
  ON "MainSiteDraftSync"("draftId", "draftVersion");
CREATE INDEX "MainSiteDraftSync_project_created_idx"
  ON "MainSiteDraftSync"("projectId", "createdAt");
CREATE INDEX "MainSiteDraftSync_draft_idx"
  ON "MainSiteDraftSync"("draftId");

ALTER TABLE "MainSiteDraftSync"
  ADD CONSTRAINT "MainSiteDraftSync_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
