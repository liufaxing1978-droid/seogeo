import type { AuthenticatedActor } from '../auth/authentication.js';

declare global {
  namespace Express {
    interface Request {
      auth: AuthenticatedActor | null;
    }
  }
}

export {};
