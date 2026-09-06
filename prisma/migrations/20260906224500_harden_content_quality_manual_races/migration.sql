ALTER TABLE "ContentQualityRun" ADD COLUMN "activeRunKey" TEXT;

CREATE UNIQUE INDEX "ContentQualityRun_activeRunKey_key" ON "ContentQualityRun"("activeRunKey");

ALTER TABLE "PublicationProposal" ADD COLUMN "p13aFindingHandoffKey" TEXT;

CREATE UNIQUE INDEX "PublicationProposal_p13aFindingHandoffKey_key" ON "PublicationProposal"("p13aFindingHandoffKey");
