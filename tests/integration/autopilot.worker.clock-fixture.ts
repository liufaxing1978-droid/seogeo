import { afterAll, vi } from 'vitest';

const NOW = new Date('2026-08-24T03:30:00.000Z');

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(NOW);

afterAll(() => {
  vi.useRealTimers();
});
