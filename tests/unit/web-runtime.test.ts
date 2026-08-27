import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

type WebRuntimeModule = {
  startWebServer(
    app: { listen(port: number, onListening?: () => void): Server },
    port: number,
    onListening?: () => void,
  ): Server;
  stopWebServer(server: Server): Promise<void>;
};

async function loadWebRuntime(): Promise<WebRuntimeModule> {
  const modulePath: string = '../../src/runtime/web-runtime.js';
  return import(modulePath) as Promise<WebRuntimeModule>;
}

describe('Release-01 Web runtime lifecycle', () => {
  it('delegates listen to a testable Web runtime', async () => {
    const { startWebServer } = await loadWebRuntime();
    const server = {} as Server;
    const onListening = vi.fn();
    const listen = vi.fn().mockReturnValue(server);

    expect(startWebServer({ listen }, 3000, onListening)).toBe(server);
    expect(listen).toHaveBeenCalledWith(3000, onListening);
  });

  it('resolves graceful shutdown when server.close succeeds', async () => {
    const { stopWebServer } = await loadWebRuntime();
    const server = {
      close(callback: (error?: Error) => void) {
        callback();
        return this;
      },
    } as unknown as Server;

    await expect(stopWebServer(server)).resolves.toBeUndefined();
  });

  it('rejects graceful shutdown when server.close reports an error', async () => {
    const { stopWebServer } = await loadWebRuntime();
    const expected = new Error('close failed');
    const server = {
      close(callback: (error?: Error) => void) {
        callback(expected);
        return this;
      },
    } as unknown as Server;

    await expect(stopWebServer(server)).rejects.toBe(expected);
  });

  it('keeps the executable Web entry thin and Worker-free', async () => {
    const source = await readFile('src/server.ts', 'utf8');

    expect(source).toContain("from './runtime/web-runtime.js'");
    expect(source).not.toContain('worker-bootstrap');
    expect(source).not.toMatch(/\.listen\s*\(/u);
    expect(source).not.toMatch(/server\.close\s*\(/u);
    expect(source).not.toContain('process.exit(');
  });
});
