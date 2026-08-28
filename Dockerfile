# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npx prisma generate
RUN npm run build

FROM build AS migration
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps \
  && rm -rf node_modules/prisma node_modules/.bin/prisma
RUN node node_modules/playwright/cli.js install --with-deps chromium

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
RUN DATABASE_URL=postgresql://probe:probe@127.0.0.1:1/probe node -e 'const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient(); prisma.$connect().then(() => process.exit(1)).catch((error) => { if (error.errorCode !== "P1001" && error.code !== "P1001") { console.error("Prisma engine/runtime compatibility probe failed:", error.message); process.exit(1); } }).finally(() => prisma.$disconnect());'
COPY --from=build /app/src/views ./dist/src/views
COPY --from=build /app/src/public ./dist/src/public
COPY --from=build /app/vendor/third-party-skills ./vendor/third-party-skills

CMD ["npm", "start"]
