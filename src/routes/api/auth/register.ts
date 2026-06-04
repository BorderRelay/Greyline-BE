import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { AppError } from "../../../lib/app-error.js";
import { createAccount } from "../../../repositories/account.repository.js";
import { createSession } from "../../../repositories/session.repository.js";
import {
  generateAccessToken,
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from "../../../services/auth.service.js";
import { env } from "../../../config/env.js";

const Body = Type.Object({
  email: Type.String({ format: "email" }),
  password: Type.String({ minLength: 8 }),
});

const Reply = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.String(),
  expiresIn: Type.Number(),
});

// eslint-disable-next-line @typescript-eslint/require-await
export const registerRoute: FastifyPluginAsyncTypebox = async (app) => {
  app.post("/register", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    schema: {
      body: Body,
      response: { 201: Reply },
      tags: ["auth"],
      summary: "Register a new account",
    },
    handler: async (request, reply) => {
      const { email, password } = request.body;

      const passwordHash = await hashPassword(password);

      let account;
      try {
        account = await createAccount(app.db, { email, passwordHash });
      } catch (err: unknown) {
        const pg = err as { code?: string };
        if (pg.code === "23505") {
          throw new AppError(409, "EMAIL_ALREADY_TAKEN", "This email address is already in use.");
        }
        throw err;
      }

      const refreshToken = generateRefreshToken();
      const refreshTokenHash = hashRefreshToken(refreshToken);
      const sessionId = randomUUID();

      await createSession(app.db, {
        id: sessionId,
        accountId: account.id,
        refreshTokenHash,
        userAgent: request.headers["user-agent"] ?? null,
        ipAddress: request.ip ?? null,
        expiresAt: refreshTokenExpiresAt(),
      });

      const accessToken = await generateAccessToken(account.id, sessionId);

      return reply
        .status(201)
        .send({ accessToken, refreshToken, expiresIn: env.JWT_ACCESS_EXPIRES_IN });
    },
  });
};
