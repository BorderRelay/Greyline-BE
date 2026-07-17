import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { env, type AppConfig } from "../src/config/env.js";
import { hashPassword } from "../src/services/auth.service.js";

const apps = new Set<ReturnType<typeof buildApp>>();
const createdAccountIds = new Map<ReturnType<typeof buildApp>, string[]>();
const createdItemDefIds = new Map<ReturnType<typeof buildApp>, string[]>();

type ErrorBody = {
  error: { code: string; message: string };
};

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...env, NODE_ENV: "test", SWAGGER_ENABLED: false, ...overrides };
}

function createApp(overrides: Partial<AppConfig> = {}) {
  const app = buildApp({ config: createConfig(overrides) });
  apps.add(app);
  createdAccountIds.set(app, []);
  createdItemDefIds.set(app, []);
  return app;
}

async function seedAccount(app: ReturnType<typeof buildApp>) {
  await app.ready();
  const accountId = randomUUID();
  const email = `raid-${accountId}@example.com`;
  const passwordHash = await hashPassword("Password123!");

  await app.db.query(
    `insert into greyline_be.accounts (id, email, password_hash) values ($1, $2, $3)`,
    [accountId, email, passwordHash],
  );
  await app.db.query(
    `insert into greyline_be.account_profiles (account_id, money) values ($1, 0)`,
    [accountId],
  );

  createdAccountIds.get(app)!.push(accountId);
  return { accountId, email, password: "Password123!" };
}

async function seedItemDef(
  app: ReturnType<typeof buildApp>,
  overrides: Record<string, unknown> = {},
) {
  const id = `test-item-${randomUUID()}`;
  await app.db.query(
    `insert into greyline_be.item_definitions
       (id, name, type, weight, base_value, stackable, max_stack)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      overrides.name ?? "Test Item",
      overrides.type ?? "valuable",
      overrides.weight ?? 0.5,
      overrides.base_value ?? 100,
      overrides.stackable ?? false,
      overrides.max_stack ?? 1,
    ],
  );
  createdItemDefIds.get(app)!.push(id);
  return id;
}

async function loginAndGetToken(
  app: ReturnType<typeof buildApp>,
  credentials: { email: string; password: string },
) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: credentials,
  });
  return res.json<{ accessToken: string }>().accessToken;
}

function successPayload(overrides: Record<string, unknown> = {}) {
  return {
    raidId: randomUUID(),
    result: "success",
    startedAt: "2026-06-02T10:00:00Z",
    endedAt: "2026-06-02T10:23:41Z",
    extractionPointId: "extract_north_01",
    deathPosition: null,
    extractedItems: [],
    ...overrides,
  };
}

function failurePayload(overrides: Record<string, unknown> = {}) {
  return {
    raidId: randomUUID(),
    result: "failure",
    startedAt: "2026-06-02T10:00:00Z",
    endedAt: "2026-06-02T10:12:03Z",
    extractionPointId: null,
    deathPosition: { x: 128, y: 512 },
    extractedItems: [],
    ...overrides,
  };
}

afterEach(async () => {
  for (const [app, ids] of createdAccountIds.entries()) {
    if (ids.length > 0) {
      await app.db.query(`delete from greyline_be.accounts where id = any($1::uuid[])`, [ids]);
    }
  }
  for (const [app, ids] of createdItemDefIds.entries()) {
    if (ids.length > 0) {
      await app.db.query(`delete from greyline_be.item_definitions where id = any($1::text[])`, [
        ids,
      ]);
    }
  }
  createdAccountIds.clear();
  createdItemDefIds.clear();
  await Promise.allSettled([...apps].map((app) => app.close()));
  apps.clear();
});

describe("POST /api/raid-results", () => {
  it("returns 401 without token", async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      payload: successPayload(),
    });

    expect(res.statusCode).toBe(401);
  });

  it("accepts a successful raid with no extracted items", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);
    const payload = successPayload();

    const res = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      accepted: true,
      raidId: payload.raidId,
      result: "success",
      stashUpdated: false,
    });

    const stored = await app.db.query<{ account_id: string }>(
      `select * from greyline_be.raid_results where id = $1`,
      [payload.raidId],
    );
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0].account_id).toBe(account.accountId);
  });

  it("accepts a successful raid, records history, and adds extracted items to stash", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const itemDefId = await seedItemDef(app, {
      name: "Gold Watch",
      stackable: false,
      max_stack: 1,
    });
    const token = await loginAndGetToken(app, account);
    const payload = successPayload({
      extractedItems: [{ itemDefinitionId: itemDefId, quantity: 1 }],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      accepted: true,
      raidId: payload.raidId,
      result: "success",
      stashUpdated: true,
    });

    const historyRows = await app.db.query(
      `select item_definition_id, quantity from greyline_be.raid_result_items where raid_result_id = $1`,
      [payload.raidId],
    );
    expect(historyRows.rows).toEqual([{ item_definition_id: itemDefId, quantity: 1 }]);

    const stashRows = await app.db.query(
      `select quantity from greyline_be.inventory_items
       where account_id = $1 and item_definition_id = $2 and location_type = 'stash'`,
      [account.accountId, itemDefId],
    );
    expect(stashRows.rows).toEqual([{ quantity: 1 }]);
  });

  it("merges stackable extracted items into an existing stash row", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const ammoDefId = await seedItemDef(app, { type: "ammo", stackable: true, max_stack: 60 });
    const existingStashId = randomUUID();
    await app.db.query(
      `insert into greyline_be.inventory_items (id, account_id, item_definition_id, quantity, location_type)
       values ($1, $2, $3, 10, 'stash')`,
      [existingStashId, account.accountId, ammoDefId],
    );
    const token = await loginAndGetToken(app, account);
    const payload = successPayload({
      extractedItems: [{ itemDefinitionId: ammoDefId, quantity: 15 }],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(res.statusCode).toBe(200);

    const stashRows = await app.db.query<{ id: string; quantity: number }>(
      `select id, quantity from greyline_be.inventory_items
       where account_id = $1 and item_definition_id = $2 and location_type = 'stash'`,
      [account.accountId, ammoDefId],
    );
    expect(stashRows.rows).toEqual([{ id: existingStashId, quantity: 25 }]);
  });

  it("accepts a failed raid, records history, and does not touch stash", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);
    const payload = failurePayload();

    const res = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      accepted: true,
      raidId: payload.raidId,
      result: "failure",
      stashUpdated: false,
    });

    const stored = await app.db.query(
      `select death_x, death_y, result from greyline_be.raid_results where id = $1`,
      [payload.raidId],
    );
    expect(stored.rows[0]).toMatchObject({
      result: "failure",
      death_x: "128.00",
      death_y: "512.00",
    });
  });

  it("rejects a successful raid that includes a death position (422)", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload: successPayload({ deathPosition: { x: 1, y: 2 } }),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("DEATH_POSITION_NOT_ALLOWED");
  });

  it("rejects a failed raid that includes extracted items (422)", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload: failurePayload({
        extractedItems: [{ itemDefinitionId: itemDefId, quantity: 1 }],
      }),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("EXTRACTED_ITEMS_NOT_ALLOWED");
  });

  it("rejects a failed raid missing a death position (422)", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload: failurePayload({ deathPosition: null }),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("DEATH_POSITION_REQUIRED");
  });

  it("rejects an unknown item definition id (422)", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload: successPayload({
        extractedItems: [{ itemDefinitionId: "does-not-exist", quantity: 1 }],
      }),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("ITEM_DEFINITION_NOT_FOUND");
  });

  it("returns 400 for malformed payload (missing required field)", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);
    const payload = successPayload() as Record<string, unknown>;
    delete payload.endedAt;

    const res = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an invalid result enum value", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload: successPayload({ result: "draw" }),
    });

    expect(res.statusCode).toBe(400);
  });

  it("is idempotent — resubmitting the same raidId with identical payload returns the same result", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const itemDefId = await seedItemDef(app, { stackable: true, max_stack: 10 });
    const token = await loginAndGetToken(app, account);
    const payload = successPayload({
      extractedItems: [{ itemDefinitionId: itemDefId, quantity: 3 }],
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      accepted: true,
      raidId: payload.raidId,
      result: "success",
    });

    // stash quantity must not be double-applied on the duplicate submission
    const stashRows = await app.db.query<{ quantity: number }>(
      `select quantity from greyline_be.inventory_items
       where account_id = $1 and item_definition_id = $2 and location_type = 'stash'`,
      [account.accountId, itemDefId],
    );
    expect(stashRows.rows).toEqual([{ quantity: 3 }]);

    const historyRows = await app.db.query<{ count: number }>(
      `select count(*)::int as count from greyline_be.raid_result_items where raid_result_id = $1`,
      [payload.raidId],
    );
    expect(historyRows.rows[0].count).toBe(1);
  });

  it("returns 409 when the same raidId is resubmitted with conflicting data", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);
    const raidId = randomUUID();

    const first = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload: successPayload({ raidId }),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/raid-results",
      headers: { authorization: `Bearer ${token}` },
      payload: failurePayload({ raidId }),
    });

    expect(second.statusCode).toBe(409);
    expect(second.json<ErrorBody>().error.code).toBe("RAID_RESULT_CONFLICT");
  });
});
