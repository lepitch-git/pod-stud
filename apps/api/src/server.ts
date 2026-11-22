import { buildApp } from "./app.js";

const port = Number(process.env.API_PORT ?? 4000);
const corsOrigins = process.env.CORS_ORIGINS?.split(",").map((s) => s.trim());

const app = await buildApp({ logger: true, corsOrigins });
await app.listen({ port, host: "0.0.0.0" });
