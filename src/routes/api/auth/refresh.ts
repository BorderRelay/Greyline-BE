import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { AppError } from "../../../lib/app-error.js";
import { findSessionByTokenHash, rotateSession } from "../../../repositories/session.repository.js";
import {
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from "../../../services/auth.service.js";
import { env } from "../../../config/env.js";

const Body = Type.Object({
  refreshToken: Type.String({ minLength: 1 }),
});

const Reply = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.String(),
  expiresIn: Type.Number(),
});

// eslint-disable-next-line @typescript-eslint/require-await
export const refreshRoute: FastifyPluginAsyncTypebox = async (app) => {
  app.post("/refresh", {
    schema: {
      body: Body,
      response: { 200: Reply },
      tags: ["auth"],
      summary: "Refresh access token using a refresh token",
    },
    handler: async (request) => {
      const { refreshToken } = request.body;
      const tokenHash = hashRefreshToken(refreshToken);

      const session = await findSessionByTokenHash(app.db, tokenHash);

      if (!session || session.expires_at < new Date()) {
        throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired.");
      }

      const newRefreshToken = generateRefreshToken();
      const newHash = hashRefreshToken(newRefreshToken);

      await rotateSession(app.db, session.id, newHash, refreshTokenExpiresAt());

      const accessToken = await generateAccessToken(session.account_id, session.id);

      return { accessToken, refreshToken: newRefreshToken, expiresIn: env.JWT_ACCESS_EXPIRES_IN };
    },
  });
};
