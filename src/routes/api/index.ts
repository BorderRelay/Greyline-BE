import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { authRoutes } from "./auth/index.js";
import { loadoutRoutes } from "./loadout/index.js";
import { marketplaceRoutes } from "./marketplace/index.js";
import { raidResultRoutes } from "./raid-results/index.js";
import { sellRoutes } from "./sell/index.js";
import { stashRoutes } from "./stash/index.js";

export const registerApiRoutes: FastifyPluginAsyncTypebox = async (app) => {
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(stashRoutes, { prefix: "/api/stash" });
  await app.register(loadoutRoutes, { prefix: "/api/loadout" });
  await app.register(sellRoutes, { prefix: "/api/sell" });
  await app.register(raidResultRoutes, { prefix: "/api/raid-results" });
  await app.register(marketplaceRoutes, { prefix: "/api/marketplace" });
};
