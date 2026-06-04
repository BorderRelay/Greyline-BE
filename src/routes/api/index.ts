import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { authRoutes } from "./auth/index.js";
import { stashRoutes } from "./stash/index.js";

export const registerApiRoutes: FastifyPluginAsyncTypebox = async (app) => {
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(stashRoutes, { prefix: "/api/stash" });
};
