import type { FastifyPluginAsync } from "fastify";

import { registerApiRoutes } from "./api/index.js";
import { registerPublicRoutes } from "./public/index.js";

export const registerRoutes: FastifyPluginAsync = async (app) => {
  await app.register(registerPublicRoutes);
  await app.register(registerApiRoutes);
};
