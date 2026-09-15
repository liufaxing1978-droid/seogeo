import express from 'express';
import { resolve } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAuthRoutes } from '../../src/auth/auth.routes.js';

function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', resolve(process.cwd(), 'src/views'));
  app.use('/auth', createAuthRoutes({
    loginAttemptLimiter: {
      async assertAllowed() {},
      async recordFailure() {},
      async clear() {},
    },
  }));
  return app;
}

describe('password reset help', () => {
  it('offers a safe administrator-assisted recovery path from login', async () => {
    const app = createApp();

    const login = await request(app).get('/auth/login').expect(200);
    expect(login.text).toContain('href="/auth/password-help"');
    expect(login.text).toContain('忘记密码');

    const help = await request(app).get('/auth/password-help').expect(200);
    expect(help.text).toContain('联系系统管理员');
    expect(help.text).toContain('为你开通账户');
    expect(help.text).toContain('href="/auth/login"');
    expect(help.text).not.toContain('name="email"');
    expect(help.text).not.toContain('<form');
  });
});
