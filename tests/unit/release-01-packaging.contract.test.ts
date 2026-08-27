import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Release-01 deployment packaging contract', () => {
  it('defines build, runtime, and migration targets on Node 22', () => {
    const dockerfile = readRepoFile('Dockerfile');

    expect(dockerfile).toContain('node:22');
    expect(dockerfile).toContain('AS build');
    expect(dockerfile).toContain('AS runtime');
    expect(dockerfile).toContain('AS migration');
    expect(dockerfile).not.toContain('alpine');
  });

  it('builds TypeScript and Prisma once and packages the runtime assets', () => {
    const dockerfile = readRepoFile('Dockerfile');

    expect(dockerfile).toContain('npm ci');
    expect(dockerfile).toContain('npx prisma generate');
    expect(dockerfile).toContain('npm run build');
    expect(dockerfile).toMatch(/npm ci[^\n]*--omit=dev/u);
    expect(dockerfile).toContain('dist');
    expect(dockerfile).toContain('prisma');
    expect(dockerfile).toContain('src/views');
    expect(dockerfile).toContain('src/public');
    expect(dockerfile).toContain('vendor/third-party-skills');
    expect(dockerfile).toContain('node node_modules/playwright/cli.js install --with-deps chromium');
    expect(dockerfile).toContain('CMD ["npm", "start"]');
  });

  it('keeps Prisma CLI in the migration role with the deploy-only command', () => {
    const dockerfile = readRepoFile('Dockerfile');

    expect(dockerfile).toContain('CMD ["npx", "prisma", "migrate", "deploy"]');
  });

  it('never bakes application secrets into ARG or ENV instructions', () => {
    const dockerfile = readRepoFile('Dockerfile');
    const secretName = '(SESSION_SECRET|DATABASE_URL|REDIS_URL|DEEPSEEK_API_KEY|GOOGLE_OAUTH_CLIENT_SECRET|OAUTH_CREDENTIAL_ENCRYPTION_KEY)';

    expect(dockerfile).not.toMatch(new RegExp(`^\\s*ARG\\s+${secretName}(?:=|\\s|$)`, 'imu'));
    expect(dockerfile).not.toMatch(new RegExp(`^\\s*ENV\\s+${secretName}(?:=|\\s|$)`, 'imu'));
  });

  it('keeps local and secret artifacts out of the Docker build context', () => {
    const dockerignore = readRepoFile('.dockerignore');
    const lines = dockerignore
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    expect(lines).toContain('.git');
    expect(lines).toContain('node_modules');
    expect(lines).toContain('dist');
    expect(lines).toContain('.env');
    expect(lines).toContain('.env.*');
    expect(lines).toContain('!.env.example');
    expect(lines).toContain('coverage');
    expect(lines).not.toContain('prisma');
    expect(lines).not.toContain('src/views');
    expect(lines).not.toContain('src/public');
    expect(lines).not.toContain('vendor/third-party-skills');
  });

  it('gates both Docker targets in a dedicated CI deployment artifact job', () => {
    const workflow = readRepoFile('.github/workflows/ci.yml');

    expect(workflow).toContain('deployment-artifact:');
    expect(workflow).toContain('docker build --target runtime');
    expect(workflow).toContain('docker build --target migration');
  });
});
