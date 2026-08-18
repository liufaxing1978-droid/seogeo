ALTER TABLE "CitabilityResult"
  ALTER COLUMN "answerFirstScore" DROP NOT NULL,
  ALTER COLUMN "factualDensityScore" DROP NOT NULL,
  ALTER COLUMN "definitionClarityScore" DROP NOT NULL;
