import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { env, type AppConfig } from "../src/config/env.js";

const apps = new Set<ReturnType<typeof buildApp>>();
const createdEmails = new Map<ReturnType<typeof buildApp>, string[]>();

type RegisterSuccessBody = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type ErrorBody = {
  error: { code: string; message: string };
};

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...env, NODE_ENV: "test", SWAGGER_ENABLED: false, ...overrides };
}

function createApp(overrides: Partial<AppConfig> = {}) {
  const app = buildApp({ config: createConfig(overrides) });
  apps.add(app);
  createdEmails.set(app, []);
  return app;
}

async function register(
  app: ReturnType<typeof buildApp>,
  payload: { email: string; password: string },
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload,
  });
  return { response, body: response.json<RegisterSuccessBody | ErrorBody>() };
}

afterEach(async () => {
  for (const [app, emails] of createdEmails.entries()) {
    if (emails.length > 0) {
      await app.db.query(`delete from greyline_be.accounts where email = any($1::text[])`, [
        emails,
      ]);
    }
  }
  createdEmails.clear();

  await Promise.allSettled([...apps].map((app) => app.close()));
  apps.clear();
});

describe("POST /api/auth/register", () => {
  it("creates an account and returns tokens on success", async () => {
    const app = createApp();
    await app.ready();

    const email = `register-${Date.now()}@example.com`;
    createdEmails.get(app)!.push(email);

    const { response, body } = await register(app, { email, password: "Password123!" });

    expect(response.statusCode).toBe(201);
    if (!("accessToken" in body)) throw new Error("Expected success body");

    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(body.expiresIn).toBe(env.JWT_ACCESS_EXPIRES_IN);
  });

  it("provisions account_profiles and all four loadout_slots", async () => {
    const app = createApp();
    await app.ready();

    const email = `register-slots-${Date.now()}@example.com`;
    createdEmails.get(app)!.push(email);

    await register(app, { email, password: "Password123!" });

    const account = await app.db.query<{ id: string }>(
      `select id from greyline_be.accounts where email = $1`,
      [email],
    );
    const accountId = account.rows[0]?.id;
    expect(accountId).toBeDefined();

    const profile = await app.db.query<{ money: string }>(
      `select money::text from greyline_be.account_profiles where account_id = $1`,
      [accountId],
    );
    expect(profile.rows[0]?.money).toBe("0");

    const slots = await app.db.query<{ slot_name: string }>(
      `select slot_name from greyline_be.loadout_slots where account_id = $1 order by slot_name`,
      [accountId],
    );
    expect(slots.rows.map((r) => r.slot_name).sort()).toEqual([
      "consumable_1",
      "consumable_2",
      "primary_weapon",
      "secondary_weapon",
    ]);
  });

  it("allows immediate login with the issued tokens", async () => {
    const app = createApp();
    await app.ready();

    const email = `register-me-${Date.now()}@example.com`;
    createdEmails.get(app)!.push(email);

    const { body: registerBody } = await register(app, { email, password: "Password123!" });
    if (!("accessToken" in registerBody)) throw new Error("Expected success body");

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${registerBody.accessToken}` },
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toMatchObject({ email, status: "active" });
  });

  it("rejects duplicate email with 409", async () => {
    const app = createApp();
    await app.ready();

    const email = `register-dup-${Date.now()}@example.com`;
    createdEmails.get(app)!.push(email);

    await register(app, { email, password: "Password123!" });
    const { response, body } = await register(app, { email, password: "OtherPass456!" });

    expect(response.statusCode).toBe(409);
    if (!("error" in body)) throw new Error("Expected error body");
    expect(body.error.code).toBe("EMAIL_ALREADY_TAKEN");
  });

  it("rejects password shorter than 8 characters with 400", async () => {
    const app = createApp();
    await app.ready();

    const { response } = await register(app, {
      email: `register-short-${Date.now()}@example.com`,
      password: "short",
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects invalid email format with 400", async () => {
    const app = createApp();
    await app.ready();

    const { response } = await register(app, {
      email: "not-an-email",
      password: "Password123!",
    });

    expect(response.statusCode).toBe(400);
  });
});
