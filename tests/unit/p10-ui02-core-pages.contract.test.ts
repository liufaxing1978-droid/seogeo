import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('P10 UI-02 core pages contract', () => {
  it('productizes login without changing or inventing authentication behavior', () => {
    const login = source('src/views/auth/login.ejs');
    const css = source('src/public/css/p10.css');

    expect(login).toContain('lang="zh-CN"');
    expect(login).toContain('/assets/css/app.css');
    expect(login).toContain('/assets/css/p10.css');
    expect(login).toContain('data-ui="login-page"');
    expect(login).toContain('data-ui="login-marketing"');
    expect(login).toContain('data-ui="login-card"');
    expect(login).toContain('action="/auth/login"');
    expect(login).toContain('name="returnPath"');
    expect(login).toContain('autocomplete="username"');
    expect(login).toContain('autocomplete="current-password"');
    expect(login).not.toContain('name="remember');
    expect(login).not.toContain('忘记密码');
    expect(login).not.toContain('注册');
    expect(css).toContain('.auth-login-page');
  });
});
