import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

type WorkerHandle = {
  close(): Promise<void>;
};

type StartWorkers = () => Promise<WorkerHandle>;

type WorkerRuntimeModule = {
  startWorkerRuntime(start?: StartWorkers): Promise<WorkerHandle>;
};

async function loadWorkerRuntime(): Promise<WorkerRuntimeModule> {
  const modulePath: string = '../../src/runtime/worker-runtime.js';
  return import(modulePath) as Promise<WorkerRuntimeModule>;
}

describe('Release-01 Worker runtime lifecycle', () => {
  it('starts the existing worker bootstrap and delegates close exactly once', async () => {
    const { startWorkerRuntime } = await loadWorkerRuntime();
    const close = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn<StartWorkers>().mockResolvedValue({ close });

    const runtime = await startWorkerRuntime(start);

    expect(start).toHaveBeenCalledTimes(1);
    await runtime.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the executable Worker entry HTTP-free and Web-free', async () => {
    const source = await readFile('src/worker.ts', 'utf8');

    expect(source).toContain("from './runtime/worker-runtime.js'");
    expect(source).not.toContain("from './app.js'");
    expect(source).not.toMatch(/\.listen\s*\(/u);
    expect(source).not.toContain('process.exit(');
  });

  it('exposes a dedicated production Worker command', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['start:worker']).toBe('node dist/src/worker.js');
    expect(packageJson.scripts?.start).toBe('node dist/src/server.js');
  });
});
