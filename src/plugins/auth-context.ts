import fp from "fastify-plugin";

import { AppError } from "../lib/app-error.js";
import { verifyAccessToken } from "../services/auth.service.js";

export const authContextPlugin = fp((app) => {
  app.decorateRequest("auth", null);

  app.decorate("requireAuth", (request) => {
    if (!request.auth) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }
  });

  app.addHook("onRequest", async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      request.auth = null;
      return;
    }

    const token = header.slice(7);
    const payload = await verifyAccessToken(token);
    request.auth = payload;
  });
});
