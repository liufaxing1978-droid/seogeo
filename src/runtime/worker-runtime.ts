import { startWorkers } from '../queue/worker-bootstrap.js';

export interface WorkerRuntime {
  close(): Promise<void>;
}

export type StartWorkers = () => Promise<WorkerRuntime>;

export async function startWorkerRuntime(
  start: StartWorkers = startWorkers,
): Promise<WorkerRuntime> {
  return start();
}
