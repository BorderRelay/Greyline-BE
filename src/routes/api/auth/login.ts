import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { AppError } from "../../../lib/app-error.js";
import { findAccountByEmail, updateLastLogin } from "../../../repositories/account.repository.js";
import { createSession, deleteExpiredSessions } from "../../../repositories/session.repository.js";
import {
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
  verifyPassword,
} from "../../../services/auth.service.js";
import { env } from "../../../config/env.js";

const Body = Type.Object({
  email: Type.String({ format: "email" }),
  password: Type.String({ minLength: 1 }),
});

const Reply = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.String(),
  expiresIn: Type.Number(),
});

// eslint-disable-next-line @typescript-eslint/require-await
export const loginRoute: FastifyPluginAsyncTypebox = async (app) => {
  app.post("/login", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    schema: {
      body: Body,
      response: { 200: Reply },
      tags: ["auth"],
      summary: "Login with email and password",
    },
    handler: async (request) => {
      const { email, password } = request.body;

      const account = await findAccountByEmail(app.db, email);

      if (!account || !account.password_hash) {
        throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
      }

      if (account.status !== "active") {
        throw new AppError(403, "ACCOUNT_DISABLED", "This account is not active.");
      }

      const valid = await verifyPassword(password, account.password_hash);
      if (!valid) {
        throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
      }

      // Lazy cleanup: sweep a bounded batch of expired sessions on every
      // successful login so account_sessions never accumulates stale rows
      // indefinitely. Bounded (default 500 rows/call, see
      // deleteExpiredSessions) so this stays fast even with a large backlog
      // instead of doing an unbounded full-table sweep on the login hot path.
      await deleteExpiredSessions(app.db);

      const refreshToken = generateRefreshToken();
      const refreshTokenHash = hashRefreshToken(refreshToken);

      const sessionId = crypto.randomUUID();
      await createSession(app.db, {
        id: sessionId,
        accountId: account.id,
        refreshTokenHash,
        userAgent: request.headers["user-agent"] ?? null,
        ipAddress: request.ip ?? null,
        expiresAt: refreshTokenExpiresAt(),
      });

      await updateLastLogin(app.db, account.id);

      const accessToken = await generateAccessToken(account.id, sessionId);

      return { accessToken, refreshToken, expiresIn: env.JWT_ACCESS_EXPIRES_IN };
    },
  });
};
