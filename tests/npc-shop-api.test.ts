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

type SellReply = {
  ok: boolean;
  money: number;
  sale: { saleId: string; totalPrice: number };
  sold: Array<{
    inventoryItemId: string;
    itemDefinitionId: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
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

async function seedAccount(app: ReturnType<typeof buildApp>, money = 500) {
  await app.ready();
  const accountId = randomUUID();
  const email = `sell-${accountId}@example.com`;
  const passwordHash = await hashPassword("Password123!");

  await app.db.query(
    `insert into greyline_be.accounts (id, email, password_hash) values ($1, $2, $3)`,
    [accountId, email, passwordHash],
  );
  await app.db.query(
    `insert into greyline_be.account_profiles (account_id, money) values ($1, $2)`,
    [accountId, money],
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

async function seedInventoryItem(
  app: ReturnType<typeof buildApp>,
  accountId: string,
  itemDefinitionId: string,
  quantity = 1,
  locationType = "stash",
) {
  const id = randomUUID();
  await app.db.query(
    `insert into greyline_be.inventory_items
       (id, account_id, item_definition_id, quantity, location_type)
     values ($1, $2, $3, $4, $5)`,
    [id, accountId, itemDefinitionId, quantity, locationType],
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

describe("POST /api/sell/item", () => {
  it("sells one item, credits money, and records sale history", async () => {
    const app = createApp();
    const account = await seedAccount(app, 500);
    const itemDefId = await seedItemDef(app, { name: "Gold Watch", base_value: 300 });
    const inventoryItemId = await seedInventoryItem(app, account.accountId, itemDefId, 1);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/item",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 1 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<SellReply>();
    expect(body.ok).toBe(true);
    expect(body.money).toBe(800);
    expect(body.sale.totalPrice).toBe(300);
    expect(body.sold).toEqual([
      {
        inventoryItemId,
        itemDefinitionId: itemDefId,
        quantity: 1,
        unitPrice: 300,
        totalPrice: 300,
      },
    ]);

    const profile = await app.db.query<{ money: string }>(
      `select money::text as money from greyline_be.account_profiles where account_id = $1`,
      [account.accountId],
    );
    expect(profile.rows[0].money).toBe("800");

    const item = await app.db.query(`select id from greyline_be.inventory_items where id = $1`, [
      inventoryItemId,
    ]);
    expect(item.rowCount).toBe(0);

    const sale = await app.db.query<{ total_price: string }>(
      `select total_price::text as total_price from greyline_be.npc_sales where id = $1`,
      [body.sale.saleId],
    );
    expect(sale.rows[0].total_price).toBe("300");

    const saleItems = await app.db.query(
      `select * from greyline_be.npc_sale_items where npc_sale_id = $1`,
      [body.sale.saleId],
    );
    expect(saleItems.rowCount).toBe(1);
  });

  it("sells part of a stack and keeps the remainder", async () => {
    const app = createApp();
    const account = await seedAccount(app, 0);
    const itemDefId = await seedItemDef(app, {
      name: "9mm Ammo",
      base_value: 5,
      stackable: true,
      max_stack: 60,
    });
    const inventoryItemId = await seedInventoryItem(app, account.accountId, itemDefId, 20);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/item",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 8 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<SellReply>();
    expect(body.money).toBe(40);
    expect(body.sale.totalPrice).toBe(40);

    const item = await app.db.query<{ quantity: number }>(
      `select quantity from greyline_be.inventory_items where id = $1`,
      [inventoryItemId],
    );
    expect(item.rows[0].quantity).toBe(12);
  });

  it("returns 404 when item does not exist", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/item",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId: randomUUID(), quantity: 1 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>().error.code).toBe("ITEM_NOT_FOUND");
  });

  it("returns 409 when item is not in stash", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const inventoryItemId = await seedInventoryItem(
      app,
      account.accountId,
      itemDefId,
      1,
      "loadout",
    );
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/item",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 1 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>().error.code).toBe("ITEM_NOT_IN_STASH");
  });

  it("returns 422 when quantity exceeds available amount", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const inventoryItemId = await seedInventoryItem(app, account.accountId, itemDefId, 2);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/item",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 3 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("INSUFFICIENT_QUANTITY");
  });

  it("returns 400 when quantity is not positive", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const inventoryItemId = await seedInventoryItem(app, account.accountId, itemDefId, 2);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/item",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 0 },
    });

    expect(res.statusCode).toBe(400);
  });

  it("does not allow selling another account's item", async () => {
    const app = createApp();
    const owner = await seedAccount(app);
    const other = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const inventoryItemId = await seedInventoryItem(app, owner.accountId, itemDefId, 1);
    const token = await loginAndGetToken(app, other);

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/item",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 1 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>().error.code).toBe("ITEM_NOT_FOUND");
  });

  it("returns 401 without a valid token", async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/item",
      payload: { inventoryItemId: randomUUID(), quantity: 1 },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/sell/bulk", () => {
  it("sells multiple items in one transaction and sums the total", async () => {
    const app = createApp();
    const account = await seedAccount(app, 0);
    const rifleDefId = await seedItemDef(app, { name: "Rifle", base_value: 300 });
    const ammoDefId = await seedItemDef(app, {
      name: "Ammo",
      base_value: 200,
      stackable: true,
      max_stack: 60,
    });
    const rifleItemId = await seedInventoryItem(app, account.accountId, rifleDefId, 1);
    const ammoItemId = await seedInventoryItem(app, account.accountId, ammoDefId, 3);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/bulk",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        items: [
          { inventoryItemId: rifleItemId, quantity: 1 },
          { inventoryItemId: ammoItemId, quantity: 3 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<SellReply>();
    expect(body.money).toBe(900);
    expect(body.sale.totalPrice).toBe(900);
    expect(body.sold).toHaveLength(2);

    const rifleRow = await app.db.query(
      `select id from greyline_be.inventory_items where id = $1`,
      [rifleItemId],
    );
    expect(rifleRow.rowCount).toBe(0);

    const ammoRow = await app.db.query(`select id from greyline_be.inventory_items where id = $1`, [
      ammoItemId,
    ]);
    expect(ammoRow.rowCount).toBe(0);
  });

  it("is all-or-nothing: one invalid line rolls back the whole request", async () => {
    const app = createApp();
    const account = await seedAccount(app, 0);
    const itemDefId = await seedItemDef(app, { base_value: 100 });
    const validItemId = await seedInventoryItem(app, account.accountId, itemDefId, 2);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/bulk",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        items: [
          { inventoryItemId: validItemId, quantity: 1 },
          { inventoryItemId: randomUUID(), quantity: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(422);

    const item = await app.db.query<{ quantity: number }>(
      `select quantity from greyline_be.inventory_items where id = $1`,
      [validItemId],
    );
    expect(item.rows[0].quantity).toBe(2);

    const profile = await app.db.query<{ money: string }>(
      `select money::text as money from greyline_be.account_profiles where account_id = $1`,
      [account.accountId],
    );
    expect(profile.rows[0].money).toBe("0");
  });

  it("returns 400 for duplicate inventoryItemId entries", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const inventoryItemId = await seedInventoryItem(app, account.accountId, itemDefId, 5);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/bulk",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        items: [
          { inventoryItemId, quantity: 1 },
          { inventoryItemId, quantity: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<ErrorBody>().error.code).toBe("DUPLICATE_SALE_ITEMS");
  });

  it("returns 400 for an empty items array", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/bulk",
      headers: { authorization: `Bearer ${token}` },
      payload: { items: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a valid token", async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/sell/bulk",
      payload: { items: [{ inventoryItemId: randomUUID(), quantity: 1 }] },
    });

    expect(res.statusCode).toBe(401);
  });
});
