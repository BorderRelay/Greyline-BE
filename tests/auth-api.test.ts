import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { env, type AppConfig } from "../src/config/env.js";
import { hashPassword } from "../src/services/auth.service.js";

const apps = new Set<ReturnType<typeof buildApp>>();
const createdAccountIds = new Map<ReturnType<typeof buildApp>, string[]>();

type AuthSuccessBody = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type AuthErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

type AuthLoginResult = {
  response: Awaited<ReturnType<ReturnType<typeof buildApp>["inject"]>>;
  body: AuthSuccessBody | AuthErrorBody;
};

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...env,
    NODE_ENV: "test",
    SWAGGER_ENABLED: false,
    ...overrides,
  };
}

function createApp(overrides: Partial<AppConfig> = {}) {
  const app = buildApp({
    config: createConfig(overrides),
  });

  apps.add(app);
  createdAccountIds.set(app, []);
  return app;
}

async function seedAccount(
  app: ReturnType<typeof buildApp>,
  options: {
    password: string;
    status?: "active" | "disabled" | "deleted";
  },
) {
  await app.ready();

  const accountId = randomUUID();
  const email = `auth-${accountId}@example.com`;
  const passwordHash = await hashPassword(options.password);

  await app.db.query(
    `insert into greyline_be.accounts (id, email, password_hash, status)
     values ($1, $2, $3, $4)`,
    [accountId, email, passwordHash, options.status ?? "active"],
  );

  await app.db.query(
    `insert into greyline_be.account_profiles (account_id, money)
     values ($1, 0)`,
    [accountId],
  );

  createdAccountIds.get(app)?.push(accountId);

  return {
    accountId,
    email,
    password: options.password,
  };
}

async function login(
  app: ReturnType<typeof buildApp>,
  credentials: {
    email: string;
    password: string;
  },
): Promise<AuthLoginResult> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: credentials,
  });

  return {
    response,
    body: response.json<AuthSuccessBody | AuthErrorBody>(),
  };
}

afterEach(async () => {
  for (const [app, accountIds] of createdAccountIds.entries()) {
    if (accountIds.length > 0) {
      await app.db.query(`delete from greyline_be.accounts where id = any($1::uuid[])`, [
        accountIds,
      ]);
    }
  }

  createdAccountIds.clear();

  await Promise.allSettled(
    [...apps].map(async (app) => {
      await app.close();
    }),
  );
  apps.clear();
});

describe("auth api", () => {
  it("logs in with valid credentials and creates a refresh session", async () => {
    const app = createApp();
    const account = await seedAccount(app, { password: "Password123!" });

    const { response, body } = await login(app, account);

    expect(response.statusCode).toBe(200);
    if (!("accessToken" in body)) {
      throw new Error("Expected login success response.");
    }

    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(body.expiresIn).toBe(env.JWT_ACCESS_EXPIRES_IN);

    const sessionCount = await app.db.query<{ count: string }>(
      `select count(*)::text as count
       from greyline_be.account_sessions
       where account_id = $1`,
      [account.accountId],
    );

    expect(Number(sessionCount.rows[0]?.count ?? "0")).toBe(1);
  });

  it("rejects invalid credentials with 401", async () => {
    const app = createApp();
    const account = await seedAccount(app, { password: "Password123!" });

    const { response, body } = await login(app, {
      email: account.email,
      password: "WrongPassword!",
    });

    expect(response.statusCode).toBe(401);
    expect("error" in body && body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects disabled accounts with 403", async () => {
    const app = createApp();
    const account = await seedAccount(app, {
      password: "Password123!",
      status: "disabled",
    });

    const { response, body } = await login(app, account);

    expect(response.statusCode).toBe(403);
    expect("error" in body && body.error.code).toBe("ACCOUNT_DISABLED");
  });

  it("returns current account information for a valid bearer token", async () => {
    const app = createApp();
    const account = await seedAccount(app, { password: "Password123!" });
    const { body } = await login(app, account);

    if (!("accessToken" in body)) {
      throw new Error("Expected login success response.");
    }

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        authorization: `Bearer ${body.accessToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accountId: account.accountId,
      email: account.email,
      status: "active",
    });
  });

  it("refreshes tokens and invalidates the previous refresh token", async () => {
    const app = createApp();
    const account = await seedAccount(app, { password: "Password123!" });
    const firstLogin = await login(app, account);

    if (!("accessToken" in firstLogin.body)) {
      throw new Error("Expected login success response.");
    }

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: {
        refreshToken: firstLogin.body.refreshToken,
      },
    });

    expect(refreshResponse.statusCode).toBe(200);
    const refreshed = refreshResponse.json<AuthSuccessBody>();
    expect(refreshed.refreshToken).not.toBe(firstLogin.body.refreshToken);

    const oldRefreshRetry = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: {
        refreshToken: firstLogin.body.refreshToken,
      },
    });

    expect(oldRefreshRetry.statusCode).toBe(401);
    expect(oldRefreshRetry.json<AuthErrorBody>().error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("logout invalidates the current refresh token", async () => {
    const app = createApp();
    const account = await seedAccount(app, { password: "Password123!" });
    const loginResult = await login(app, account);

    if (!("accessToken" in loginResult.body)) {
      throw new Error("Expected login success response.");
    }

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        authorization: `Bearer ${loginResult.body.accessToken}`,
      },
      payload: {
        refreshToken: loginResult.body.refreshToken,
      },
    });

    expect(logoutResponse.statusCode).toBe(204);

    const refreshAfterLogout = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: {
        refreshToken: loginResult.body.refreshToken,
      },
    });

    expect(refreshAfterLogout.statusCode).toBe(401);
    expect(refreshAfterLogout.json<AuthErrorBody>().error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("sweeps expired sessions on login (lazy cleanup)", async () => {
    const app = createApp();
    const account = await seedAccount(app, { password: "Password123!" });

    const expiredSessionId = randomUUID();
    await app.db.query(
      `insert into greyline_be.account_sessions
         (id, account_id, refresh_token_hash, expires_at)
       values ($1, $2, $3, now() - interval '1 day')`,
      [expiredSessionId, account.accountId, `expired-hash-${expiredSessionId}`],
    );

    const staleButValidSessionId = randomUUID();
    await app.db.query(
      `insert into greyline_be.account_sessions
         (id, account_id, refresh_token_hash, expires_at)
       values ($1, $2, $3, now() + interval '1 day')`,
      [staleButValidSessionId, account.accountId, `valid-hash-${staleButValidSessionId}`],
    );

    const { response } = await login(app, account);
    expect(response.statusCode).toBe(200);

    const expiredRow = await app.db.query(
      `select id from greyline_be.account_sessions where id = $1`,
      [expiredSessionId],
    );
    expect(expiredRow.rowCount).toBe(0);

    const remainingSessions = await app.db.query<{ count: string }>(
      `select count(*)::text as count
       from greyline_be.account_sessions
       where account_id = $1`,
      [account.accountId],
    );

    // The still-valid pre-existing session plus the new session created by this login.
    expect(Number(remainingSessions.rows[0]?.count ?? "0")).toBe(2);
  });

  it("logout-all invalidates every active session for the account", async () => {
    const app = createApp();
    const account = await seedAccount(app, { password: "Password123!" });
    const first = await login(app, account);
    const second = await login(app, account);

    if (!("accessToken" in first.body) || !("accessToken" in second.body)) {
      throw new Error("Expected login success response.");
    }

    const logoutAllResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout-all",
      headers: {
        authorization: `Bearer ${first.body.accessToken}`,
      },
    });

    expect(logoutAllResponse.statusCode).toBe(204);

    const firstRefresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: {
        refreshToken: first.body.refreshToken,
      },
    });

    const secondRefresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: {
        refreshToken: second.body.refreshToken,
      },
    });

    expect(firstRefresh.statusCode).toBe(401);
    expect(secondRefresh.statusCode).toBe(401);
  });
});
