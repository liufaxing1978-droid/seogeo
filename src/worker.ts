import { startWorkerRuntime } from './runtime/worker-runtime.js';

const runtime = await startWorkerRuntime();
console.log('SEO GEO worker runtime started');

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down workers`);

  try {
    await runtime.close();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
