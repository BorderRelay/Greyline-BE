import type { FastifyPluginAsync } from "fastify";

import { healthRoutePlugin } from "./health.js";

export const registerPublicRoutes: FastifyPluginAsync = async (app) => {
  await app.register(healthRoutePlugin, {
    prefix: "/api",
  });
};
