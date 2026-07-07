import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { env, type AppConfig } from "../src/config/env.js";
import { hashPassword } from "../src/services/auth.service.js";

const apps = new Set<ReturnType<typeof buildApp>>();
const createdAccountIds = new Map<ReturnType<typeof buildApp>, string[]>();
const createdItemDefIds = new Map<ReturnType<typeof buildApp>, string[]>();

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

async function seedAccount(app: ReturnType<typeof buildApp>, password = "Password123!") {
  await app.ready();
  const accountId = randomUUID();
  const email = `stash-${accountId}@example.com`;
  const passwordHash = await hashPassword(password);

  await app.db.query(
    `insert into greyline_be.accounts (id, email, password_hash) values ($1, $2, $3)`,
    [accountId, email, passwordHash],
  );
  await app.db.query(
    `insert into greyline_be.account_profiles (account_id, money) values ($1, 500)`,
    [accountId],
  );

  createdAccountIds.get(app)!.push(accountId);
  return { accountId, email, password };
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

async function seedStashItem(
  app: ReturnType<typeof buildApp>,
  accountId: string,
  itemDefinitionId: string,
  quantity = 1,
) {
  const id = randomUUID();
  await app.db.query(
    `insert into greyline_be.inventory_items
       (id, account_id, item_definition_id, quantity, location_type)
     values ($1, $2, $3, $4, 'stash')`,
    [id, accountId, itemDefinitionId, quantity],
  );
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

afterEach(async () => {
  // accounts first — cascades to inventory_items, then item_definitions can be safely deleted
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

describe("GET /api/stash", () => {
  it("returns money and empty items when stash is empty", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "GET",
      url: "/api/stash",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accountId: account.accountId, money: 500, items: [] });
  });

  it("returns stash items with correct fields", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const itemDefId = await seedItemDef(app, {
      name: "Gold Watch",
      type: "valuable",
      weight: 0.1,
      base_value: 300,
      stackable: false,
      max_stack: 1,
    });
    await seedStashItem(app, account.accountId, itemDefId);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "GET",
      url: "/api/stash",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ money: number; items: unknown[] }>();
    expect(body.money).toBe(500);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      itemDefinitionId: itemDefId,
      quantity: 1,
      loadedAmmoCount: null,
      name: "Gold Watch",
      weight: 0.1,
      type: "valuable",
      stackable: false,
      maxStack: 1,
      baseValue: 300,
    });
  });

  it("returns only stash-location items, not loadout items", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const itemDefId = await seedItemDef(app);

    const stashItemId = randomUUID();
    await app.db.query(
      `insert into greyline_be.inventory_items (id, account_id, item_definition_id, quantity, location_type)
       values ($1, $2, $3, 1, 'stash')`,
      [stashItemId, account.accountId, itemDefId],
    );

    const loadoutItemId = randomUUID();
    await app.db.query(
      `insert into greyline_be.inventory_items (id, account_id, item_definition_id, quantity, location_type)
       values ($1, $2, $3, 1, 'loadout')`,
      [loadoutItemId, account.accountId, itemDefId],
    );

    const token = await loginAndGetToken(app, account);
    const res = await app.inject({
      method: "GET",
      url: "/api/stash",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ inventoryItemId: string }> }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].inventoryItemId).toBe(stashItemId);
  });

  it("returns stackable items with correct quantity", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const itemDefId = await seedItemDef(app, {
      name: "9mm Ammo",
      type: "ammo",
      stackable: true,
      max_stack: 60,
    });
    await seedStashItem(app, account.accountId, itemDefId, 45);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "GET",
      url: "/api/stash",
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json<{
      items: Array<{ quantity: number; stackable: boolean; maxStack: number }>;
    }>();
    expect(body.items[0]).toMatchObject({ quantity: 45, stackable: true, maxStack: 60 });
  });

  it("returns 401 without a valid token", async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/stash" });
    expect(res.statusCode).toBe(401);
  });
});
