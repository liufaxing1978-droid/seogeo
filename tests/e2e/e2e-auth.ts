import type { BrowserContext } from '@playwright/test';
import type { SeedAuthenticatedUserOptions } from '../helpers/auth-fixture.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

export async function authenticateE2e(
  context: BrowserContext,
  options: SeedAuthenticatedUserOptions,
) {
  const fixture = await seedAuthenticatedUser(options);
  const separator = fixture.sessionCookie.indexOf('=');
  await context.addCookies([
    {
      name: fixture.sessionCookie.slice(0, separator),
      value: fixture.sessionCookie.slice(separator + 1),
      url: 'http://127.0.0.1:3000',
    },
  ]);
  return fixture;
}
