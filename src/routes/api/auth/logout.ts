import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { AppError } from "../../../lib/app-error.js";
import { deleteSession, deleteAllSessions } from "../../../repositories/session.repository.js";
import { hashRefreshToken } from "../../../services/auth.service.js";

const Body = Type.Object({
  refreshToken: Type.String({ minLength: 1 }),
});

// eslint-disable-next-line @typescript-eslint/require-await
export const logoutRoute: FastifyPluginAsyncTypebox = async (app) => {
  app.post("/logout", {
    schema: {
      body: Body,
      tags: ["auth"],
      summary: "Logout current device session",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const tokenHash = hashRefreshToken(request.body.refreshToken);
      await deleteSession(app.db, tokenHash, request.auth.accountId);

      return reply.status(204).send();
    },
  });

  app.post("/logout-all", {
    schema: {
      tags: ["auth"],
      summary: "Logout all device sessions",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      await deleteAllSessions(app.db, request.auth.accountId);

      return reply.status(204).send();
    },
  });
};
