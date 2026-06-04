import fp from "fastify-plugin";

import { AppError } from "../lib/app-error.js";

export const authContextPlugin = fp((app) => {
  app.decorateRequest("auth", null);

  app.decorate("requireAuth", (request) => {
    if (!request.auth) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }
  });

  app.addHook("onRequest", (request, _reply, done) => {
    request.auth = null;
    done();
  });
});
