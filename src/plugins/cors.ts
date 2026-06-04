import cors from "@fastify/cors";
import fp from "fastify-plugin";

import type { AppConfig } from "../config/env.js";

function resolveCorsOrigin(corsOrigin: string) {
  if (corsOrigin === "*") {
    return true;
  }

  const origins = corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return false;
  }

  return origins.length === 1 ? origins[0] : origins;
}

export const corsPlugin = fp<{ config: AppConfig }>(async (app, options) => {
  await app.register(cors, {
    origin: resolveCorsOrigin(options.config.CORS_ORIGIN),
  });
});
