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
  const email = `loadout-${accountId}@example.com`;
  const passwordHash = await hashPassword("Password123!");

  await app.db.query(
    `insert into greyline_be.accounts (id, email, password_hash) values ($1, $2, $3)`,
    [accountId, email, passwordHash],
  );
  await app.db.query(
    `insert into greyline_be.account_profiles (account_id, money) values ($1, 0)`,
    [accountId],
  );
  for (const slot of ["primary_weapon", "secondary_weapon", "consumable_1", "consumable_2"]) {
    await app.db.query(
      `insert into greyline_be.loadout_slots (account_id, slot_name) values ($1, $2)`,
      [accountId, slot],
    );
  }

  createdAccountIds.get(app)!.push(accountId);
  return { accountId, email, password: "Password123!" };
}

async function seedItemDef(
  app: ReturnType<typeof buildApp>,
  type: string,
  overrides: Record<string, unknown> = {},
) {
  const id = `test-${type}-${randomUUID()}`;
  await app.db.query(
    `insert into greyline_be.item_definitions
       (id, name, type, weight, base_value, stackable, max_stack)
     values ($1, $2, $3, 0.5, 100, false, 1)`,
    [id, overrides.name ?? `Test ${type}`, type],
  );
  createdItemDefIds.get(app)!.push(id);
  return id;
}

async function seedInventoryItem(
  app: ReturnType<typeof buildApp>,
  accountId: string,
  itemDefinitionId: string,
  locationType = "stash",
) {
  const id = randomUUID();
  await app.db.query(
    `insert into greyline_be.inventory_items
       (id, account_id, item_definition_id, quantity, location_type)
     values ($1, $2, $3, 1, $4)`,
    [id, accountId, itemDefinitionId, locationType],
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

describe("GET /api/loadout", () => {
  it("returns all four slots, empty by default", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "GET",
      url: "/api/loadout",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const slots = res.json<Array<{ slotName: string; inventoryItemId: null }>>();
    expect(slots).toHaveLength(4);
    expect(slots.every((s) => s.inventoryItemId === null)).toBe(true);
    expect(slots.map((s) => s.slotName).sort()).toEqual([
      "consumable_1",
      "consumable_2",
      "primary_weapon",
      "secondary_weapon",
    ]);
  });

  it("returns slot item details after equip", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const weaponDefId = await seedItemDef(app, "weapon", { name: "AK-74" });
    const inventoryItemId = await seedInventoryItem(app, account.accountId, weaponDefId);
    const token = await loginAndGetToken(app, account);

    await app.inject({
      method: "POST",
      url: "/api/loadout/equip",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, slotName: "primary_weapon" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/loadout",
      headers: { authorization: `Bearer ${token}` },
    });

    const slots =
      res.json<Array<{ slotName: string; inventoryItemId: string | null; name: string | null }>>();
    const primary = slots.find((s) => s.slotName === "primary_weapon");
    expect(primary?.inventoryItemId).toBe(inventoryItemId);
    expect(primary?.name).toBe("AK-74");
  });

  it("returns 401 without token", async () => {
    const app = createApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/loadout" });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/loadout/equip", () => {
  it("moves item from stash to slot", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const weaponDefId = await seedItemDef(app, "weapon");
    const inventoryItemId = await seedInventoryItem(app, account.accountId, weaponDefId);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/loadout/equip",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, slotName: "primary_weapon" },
    });

    expect(res.statusCode).toBe(204);

    const item = await app.db.query<{ location_type: string }>(
      `select location_type from greyline_be.inventory_items where id = $1`,
      [inventoryItemId],
    );
    expect(item.rows[0].location_type).toBe("loadout");

    const slot = await app.db.query<{ inventory_item_id: string }>(
      `select inventory_item_id from greyline_be.loadout_slots
       where account_id = $1 and slot_name = 'primary_weapon'`,
      [account.accountId],
    );
    expect(slot.rows[0].inventory_item_id).toBe(inventoryItemId);
  });

  it("displaces existing item back to stash when equipping to occupied slot", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const weaponDefId = await seedItemDef(app, "weapon");
    const firstItemId = await seedInventoryItem(app, account.accountId, weaponDefId);
    const secondItemId = await seedInventoryItem(app, account.accountId, weaponDefId);
    const token = await loginAndGetToken(app, account);

    await app.inject({
      method: "POST",
      url: "/api/loadout/equip",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId: firstItemId, slotName: "primary_weapon" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/loadout/equip",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId: secondItemId, slotName: "primary_weapon" },
    });

    expect(res.statusCode).toBe(204);

    const first = await app.db.query<{ location_type: string }>(
      `select location_type from greyline_be.inventory_items where id = $1`,
      [firstItemId],
    );
    expect(first.rows[0].location_type).toBe("stash");

    const second = await app.db.query<{ location_type: string }>(
      `select location_type from greyline_be.inventory_items where id = $1`,
      [secondItemId],
    );
    expect(second.rows[0].location_type).toBe("loadout");
  });

  it("rejects type mismatch — weapon into consumable slot", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const weaponDefId = await seedItemDef(app, "weapon");
    const inventoryItemId = await seedInventoryItem(app, account.accountId, weaponDefId);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/loadout/equip",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, slotName: "consumable_1" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("SLOT_TYPE_MISMATCH");
  });

  it("rejects medical in weapon slot", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const medDefId = await seedItemDef(app, "medical");
    const inventoryItemId = await seedInventoryItem(app, account.accountId, medDefId);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/loadout/equip",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, slotName: "primary_weapon" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("SLOT_TYPE_MISMATCH");
  });

  it("rejects item not in stash", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const weaponDefId = await seedItemDef(app, "weapon");
    const inventoryItemId = await seedInventoryItem(app, account.accountId, weaponDefId, "loadout");
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/loadout/equip",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, slotName: "primary_weapon" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>().error.code).toBe("ITEM_NOT_IN_STASH");
  });

  it("rejects invalid slot name", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const weaponDefId = await seedItemDef(app, "weapon");
    const inventoryItemId = await seedInventoryItem(app, account.accountId, weaponDefId);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/loadout/equip",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, slotName: "invalid_slot" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("INVALID_SLOT");
  });
});

describe("POST /api/loadout/unequip", () => {
  it("moves item from slot back to stash", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const weaponDefId = await seedItemDef(app, "weapon");
    const inventoryItemId = await seedInventoryItem(app, account.accountId, weaponDefId);
    const token = await loginAndGetToken(app, account);

    await app.inject({
      method: "POST",
      url: "/api/loadout/equip",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, slotName: "primary_weapon" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/loadout/unequip",
      headers: { authorization: `Bearer ${token}` },
      payload: { slotName: "primary_weapon" },
    });

    expect(res.statusCode).toBe(204);

    const item = await app.db.query<{ location_type: string }>(
      `select location_type from greyline_be.inventory_items where id = $1`,
      [inventoryItemId],
    );
    expect(item.rows[0].location_type).toBe("stash");

    const slot = await app.db.query<{ inventory_item_id: string | null }>(
      `select inventory_item_id from greyline_be.loadout_slots
       where account_id = $1 and slot_name = 'primary_weapon'`,
      [account.accountId],
    );
    expect(slot.rows[0].inventory_item_id).toBeNull();
  });

  it("rejects unequip on empty slot", async () => {
    const app = createApp();
    const account = await seedAccount(app);
    const token = await loginAndGetToken(app, account);

    const res = await app.inject({
      method: "POST",
      url: "/api/loadout/unequip",
      headers: { authorization: `Bearer ${token}` },
      payload: { slotName: "primary_weapon" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>().error.code).toBe("SLOT_EMPTY");
  });
});
