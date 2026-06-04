import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { loginRoute } from "./login.js";
import { logoutRoute } from "./logout.js";
import { meRoute } from "./me.js";
import { refreshRoute } from "./refresh.js";

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  await app.register(loginRoute);
  await app.register(refreshRoute);
  await app.register(meRoute);
  await app.register(logoutRoute);
};
