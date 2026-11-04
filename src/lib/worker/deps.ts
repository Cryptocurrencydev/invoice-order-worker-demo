import { anthropicClient } from "./model";
import { mockModel } from "./mock-model";
import type { WorkerDeps } from "./pipeline";

export function workerDeps(): WorkerDeps {
  return { model: process.env.WORKER_MODEL === "mock" ? mockModel() : anthropicClient() };
}
