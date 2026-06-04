import { createHash, randomUUID } from "node:crypto";

import * as argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";

import { env } from "../config/env.js";

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

function getJwtSecret() {
  return new TextEncoder().encode(env.JWT_SECRET);
}

export type AccessTokenPayload = {
  accountId: string;
  sessionId: string;
};

export async function generateAccessToken(accountId: string, sessionId: string): Promise<string> {
  return new SignJWT({ accountId, sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_ACCESS_EXPIRES_IN}s`)
    .sign(getJwtSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (typeof payload.accountId !== "string" || typeof payload.sessionId !== "string") {
      return null;
    }
    return { accountId: payload.accountId, sessionId: payload.sessionId };
  } catch {
    return null;
  }
}

export function generateRefreshToken(): string {
  return randomUUID();
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiresAt(): Date {
  const date = new Date();
  date.setDate(date.getDate() + env.REFRESH_TOKEN_EXPIRES_DAYS);
  return date;
}
