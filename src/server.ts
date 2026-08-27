import { createApp } from './app.js';
import { env } from './config/env.js';
import { startWebServer, stopWebServer } from './runtime/web-runtime.js';

const server = startWebServer(createApp(), env.PORT, () => {
  console.log(`SEO GEO listening on :${env.PORT}`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  try {
    await stopWebServer(server);
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
