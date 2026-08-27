import type { Express } from 'express';
import type { Server } from 'node:http';

export function startWebServer(
  app: Express,
  port: number,
  onListening?: () => void,
): Server {
  return app.listen(port, onListening);
}

export function stopWebServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
