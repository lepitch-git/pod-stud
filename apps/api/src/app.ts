import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

export interface AppOptions {
  /** Origines web autorisées à appeler l'API (CORS). */
  corsOrigins?: string[];
  logger?: boolean;
}

export const API_VERSION = process.env.APP_VERSION ?? "dev";

/**
 * API du studio. Pour l'instant : état de santé uniquement.
 * Les routes d'envoi des morceaux (étape 3) et des comptes (étape 5) viendront s'ajouter ici.
 */
export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: opts.corsOrigins ?? true });

  app.get("/health", async () => ({
    status: "ok",
    service: "pod-stud-api",
    version: API_VERSION,
    time: new Date().toISOString(),
  }));

  return app;
}
