import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { AppError } from "../../../lib/app-error.js";
import { findAccountById } from "../../../repositories/account.repository.js";

const Reply = Type.Object({
  accountId: Type.String(),
  email: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
});

// eslint-disable-next-line @typescript-eslint/require-await
export const meRoute: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/me", {
    schema: {
      response: { 200: Reply },
      tags: ["auth"],
      summary: "Get current authenticated account",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const account = await findAccountById(app.db, request.auth.accountId);
      if (!account) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
      }

      return { accountId: account.id, email: account.email, status: account.status };
    },
  });
};
