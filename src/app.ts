import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";

import { env } from "./config/env.js";
import { registerHealthRoutes } from "./routes/health.js";

export function buildApp(options: FastifyServerOptions = {}) {
  const app = Fastify({
    logger: env.NODE_ENV === "development",
    ...options,
  });

  app.register(cors, {
    origin: true,
  });

  app.register(sensible);

  registerHealthRoutes(app);

  return app;
}
