ALTER TYPE "VisibilityProvider" ADD VALUE 'BAIDU_QIANFAN';
ALTER TYPE "VisibilityProvider" ADD VALUE 'QWEN';
ALTER TYPE "VisibilityProvider" ADD VALUE 'TENCENT_HUNYUAN';

CREATE TYPE "VisibilityProviderCapability" AS ENUM (
  'MODEL_ONLY',
  'WEB_GROUNDED',
  'SEARCH_API',
  'CITATION_NATIVE',
  'CONSUMER_OBSERVATION'
);

ALTER TABLE "VisibilityProviderConfig"
ADD COLUMN "capabilities" "VisibilityProviderCapability"[] NOT NULL
DEFAULT ARRAY[]::"VisibilityProviderCapability"[];
