import type { Express } from 'express';

export function configureTrustProxy(app: Express, hops: number): void {
  app.set('trust proxy', hops === 0 ? false : hops);
}
