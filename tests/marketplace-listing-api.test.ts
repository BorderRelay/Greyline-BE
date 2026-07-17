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

type ListingReply = {
  listingId: string;
  sellerAccountId: string;
  inventoryItemId: string;
  itemDefinitionId: string;
  itemName: string;
  itemType: string;
  quantity: number;
  listedUnitPrice: number;
  totalListedPrice: number;
  feePolicyType: string;
  feeRateBps: number | null;
  feeFlatAmount: number | null;
  status: string;
  expiresAt: string;
  cancelledAt: string | null;
  soldAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListingListReply = { items: ListingReply[] };

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
  const email = `market-${accountId}@example.com`;
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
       (id, name, type, weight, base_value, stackable, max_stack, marketplace_policy)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      overrides.name ?? "Test Item",
      overrides.type ?? "valuable",
      overrides.weight ?? 0.5,
      overrides.base_value ?? 100,
      overrides.stackable ?? false,
      overrides.max_stack ?? 1,
      overrides.marketplace_policy ?? "tradable",
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

async function seedListing(
  app: ReturnType<typeof buildApp>,
  sellerAccountId: string,
  itemDefinitionId: string,
  overrides: {
    quantity?: number;
    unitPrice?: number;
    status?: string;
    expiresInHours?: number;
    cancelledAt?: boolean;
  } = {},
) {
  const quantity = overrides.quantity ?? 1;
  const unitPrice = overrides.unitPrice ?? 100;
  const status = overrides.status ?? "active";
  const inventoryItemId = await seedInventoryItem(
    app,
    sellerAccountId,
    itemDefinitionId,
    quantity,
    status === "cancelled" || status === "expired" ? "stash" : "marketplace_escrow",
  );

  const listingId = randomUUID();
  const expiresInHours = overrides.expiresInHours ?? 24;

  await app.db.query(
    `insert into greyline_be.marketplace_listings
       (id, seller_account_id, inventory_item_id, item_definition_id, quantity,
        listed_unit_price, total_listed_price, fee_policy_type, fee_rate_bps, status,
        expires_at, cancelled_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'percentage', 500, $8,
             now() + ($9::text || ' hours')::interval, $10)`,
    [
      listingId,
      sellerAccountId,
      inventoryItemId,
      itemDefinitionId,
      quantity,
      unitPrice,
      unitPrice * quantity,
      status,
      expiresInHours,
      overrides.cancelledAt ? new Date() : null,
    ],
  );

  return { listingId, inventoryItemId };
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
  // marketplace_listings has no ON DELETE CASCADE from accounts/item_definitions
  // (unlike inventory_items), so listing rows must be cleared first.
  for (const [app, ids] of createdAccountIds.entries()) {
    if (ids.length > 0) {
      await app.db.query(
        `delete from greyline_be.marketplace_listings where seller_account_id = any($1::uuid[])`,
        [ids],
      );
    }
  }
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

describe("POST /api/marketplace/listings", () => {
  it("lists a whole non-stackable item and moves it to escrow", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app, { name: "Rifle", type: "weapon" });
    const inventoryItemId = await seedInventoryItem(app, seller.accountId, itemDefId, 1);
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/listings",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 1, unitPrice: 250, durationHours: 24 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ListingReply>();
    expect(body).toMatchObject({
      sellerAccountId: seller.accountId,
      inventoryItemId,
      itemDefinitionId: itemDefId,
      itemName: "Rifle",
      itemType: "weapon",
      quantity: 1,
      listedUnitPrice: 250,
      totalListedPrice: 250,
      feePolicyType: "percentage",
      feeRateBps: 500,
      feeFlatAmount: null,
      status: "active",
      cancelledAt: null,
      soldAt: null,
    });

    const item = await app.db.query<{ location_type: string }>(
      `select location_type from greyline_be.inventory_items where id = $1`,
      [inventoryItemId],
    );
    expect(item.rows[0].location_type).toBe("marketplace_escrow");
  });

  it("splits a stack when listing a partial quantity", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app, {
      name: "9mm Ammo",
      type: "ammo",
      stackable: true,
      max_stack: 60,
    });
    const inventoryItemId = await seedInventoryItem(app, seller.accountId, itemDefId, 20);
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/listings",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 8, unitPrice: 5, durationHours: 12 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ListingReply>();
    expect(body.quantity).toBe(8);
    expect(body.totalListedPrice).toBe(40);
    expect(body.inventoryItemId).not.toBe(inventoryItemId);

    const original = await app.db.query<{ quantity: number; location_type: string }>(
      `select quantity, location_type from greyline_be.inventory_items where id = $1`,
      [inventoryItemId],
    );
    expect(original.rows[0]).toMatchObject({ quantity: 12, location_type: "stash" });

    const escrow = await app.db.query<{ quantity: number; location_type: string }>(
      `select quantity, location_type from greyline_be.inventory_items where id = $1`,
      [body.inventoryItemId],
    );
    expect(escrow.rows[0]).toMatchObject({ quantity: 8, location_type: "marketplace_escrow" });
  });

  it("returns 404 when the inventory item does not exist", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/listings",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId: randomUUID(), quantity: 1, unitPrice: 10, durationHours: 12 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>().error.code).toBe("ITEM_NOT_FOUND");
  });

  it("returns 404 when listing another account's item", async () => {
    const app = createApp();
    const owner = await seedAccount(app);
    const other = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const inventoryItemId = await seedInventoryItem(app, owner.accountId, itemDefId, 1);
    const token = await loginAndGetToken(app, other);

    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/listings",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 1, unitPrice: 10, durationHours: 12 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>().error.code).toBe("ITEM_NOT_FOUND");
  });

  it("returns 409 when the item is not in stash", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const inventoryItemId = await seedInventoryItem(app, seller.accountId, itemDefId, 1, "loadout");
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/listings",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 1, unitPrice: 10, durationHours: 12 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>().error.code).toBe("ITEM_NOT_IN_STASH");
  });

  it("returns 422 when quantity exceeds available amount", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app, { stackable: true, max_stack: 60 });
    const inventoryItemId = await seedInventoryItem(app, seller.accountId, itemDefId, 3);
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/listings",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 5, unitPrice: 10, durationHours: 12 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("INSUFFICIENT_QUANTITY");
  });

  it("returns 422 when the item is not tradable", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app, { marketplace_policy: "non_tradable" });
    const inventoryItemId = await seedInventoryItem(app, seller.accountId, itemDefId, 1);
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/listings",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 1, unitPrice: 10, durationHours: 12 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("ITEM_NOT_TRADABLE");
  });

  it("returns 422 when a non-stackable item is listed with a partial quantity", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app, { stackable: false });
    // Not a normally reachable state via other flows, but the repository must still
    // defend against it since the DB does not enforce stackable <-> quantity=1.
    const inventoryItemId = await seedInventoryItem(app, seller.accountId, itemDefId, 3);
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/listings",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 2, unitPrice: 10, durationHours: 12 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("INVALID_LISTING_QUANTITY");
  });

  it("returns 400 for an invalid durationHours value", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const inventoryItemId = await seedInventoryItem(app, seller.accountId, itemDefId, 1);
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/listings",
      headers: { authorization: `Bearer ${token}` },
      payload: { inventoryItemId, quantity: 1, unitPrice: 10, durationHours: 5 },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a valid token", async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/listings",
      payload: { inventoryItemId: randomUUID(), quantity: 1, unitPrice: 10, durationHours: 12 },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/marketplace/listings", () => {
  it("returns only active, non-expired listings", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app, { name: "Bandage", type: "medical" });
    const { listingId: activeId } = await seedListing(app, seller.accountId, itemDefId, {
      unitPrice: 20,
    });
    const { listingId: cancelledId } = await seedListing(app, seller.accountId, itemDefId, {
      status: "cancelled",
    });
    const { listingId: expiredId, inventoryItemId: expiredInventoryItemId } = await seedListing(
      app,
      seller.accountId,
      itemDefId,
      { expiresInHours: -1 },
    );
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "GET",
      url: "/api/marketplace/listings",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ListingListReply>();
    const ids = body.items.map((item) => item.listingId);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(cancelledId);
    expect(ids).not.toContain(expiredId);

    // lazy expiration side effect: the past-due listing flips to 'expired'
    // and its escrowed item returns to the seller's stash.
    const expiredRow = await app.db.query<{ status: string }>(
      `select status from greyline_be.marketplace_listings where id = $1`,
      [expiredId],
    );
    expect(expiredRow.rows[0].status).toBe("expired");

    const returnedItem = await app.db.query<{ location_type: string }>(
      `select location_type from greyline_be.inventory_items where id = $1`,
      [expiredInventoryItemId],
    );
    expect(returnedItem.rows[0].location_type).toBe("stash");
  });

  it("filters by itemType", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const weaponDefId = await seedItemDef(app, { name: "Pistol", type: "weapon" });
    const foodDefId = await seedItemDef(app, { name: "Canned Beans", type: "food" });
    const { listingId: weaponListingId } = await seedListing(app, seller.accountId, weaponDefId);
    await seedListing(app, seller.accountId, foodDefId);
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "GET",
      url: "/api/marketplace/listings?itemType=weapon",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ListingListReply>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].listingId).toBe(weaponListingId);
  });

  it("sorts by price ascending and descending", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const { listingId: cheapId } = await seedListing(app, seller.accountId, itemDefId, {
      unitPrice: 10,
    });
    const { listingId: pricyId } = await seedListing(app, seller.accountId, itemDefId, {
      unitPrice: 90,
    });
    const token = await loginAndGetToken(app, seller);

    const ascRes = await app.inject({
      method: "GET",
      url: "/api/marketplace/listings?sort=price_asc",
      headers: { authorization: `Bearer ${token}` },
    });
    const ascBody = ascRes.json<ListingListReply>();
    expect(ascBody.items[0].listingId).toBe(cheapId);
    expect(ascBody.items[1].listingId).toBe(pricyId);

    const descRes = await app.inject({
      method: "GET",
      url: "/api/marketplace/listings?sort=price_desc",
      headers: { authorization: `Bearer ${token}` },
    });
    const descBody = descRes.json<ListingListReply>();
    expect(descBody.items[0].listingId).toBe(pricyId);
    expect(descBody.items[1].listingId).toBe(cheapId);
  });

  it("returns 401 without a valid token", async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/marketplace/listings" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/marketplace/listings/mine", () => {
  it("returns the caller's own listings across all statuses", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const other = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const { listingId: activeId } = await seedListing(app, seller.accountId, itemDefId);
    const { listingId: cancelledId } = await seedListing(app, seller.accountId, itemDefId, {
      status: "cancelled",
    });
    const { listingId: otherId } = await seedListing(app, other.accountId, itemDefId);
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "GET",
      url: "/api/marketplace/listings/mine",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const ids = res.json<ListingListReply>().items.map((item) => item.listingId);
    expect(ids).toEqual(expect.arrayContaining([activeId, cancelledId]));
    expect(ids).not.toContain(otherId);
  });

  it("filters by status", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const { listingId: activeId } = await seedListing(app, seller.accountId, itemDefId);
    await seedListing(app, seller.accountId, itemDefId, { status: "cancelled" });
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "GET",
      url: "/api/marketplace/listings/mine?status=active",
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json<ListingListReply>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].listingId).toBe(activeId);
  });

  it("returns 401 without a valid token", async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/marketplace/listings/mine" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/marketplace/listings/:id", () => {
  it("returns detail for an active listing to a non-owner buyer", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const buyer = await seedAccount(app);
    const itemDefId = await seedItemDef(app, { name: "Med Kit", type: "medical" });
    const { listingId } = await seedListing(app, seller.accountId, itemDefId, { unitPrice: 75 });
    const token = await loginAndGetToken(app, buyer);

    const res = await app.inject({
      method: "GET",
      url: `/api/marketplace/listings/${listingId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<ListingReply>()).toMatchObject({
      listingId,
      status: "active",
      listedUnitPrice: 75,
    });
  });

  it("returns 404 for a non-active listing viewed by a non-owner", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const buyer = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const { listingId } = await seedListing(app, seller.accountId, itemDefId, {
      status: "cancelled",
    });
    const token = await loginAndGetToken(app, buyer);

    const res = await app.inject({
      method: "GET",
      url: `/api/marketplace/listings/${listingId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>().error.code).toBe("LISTING_NOT_FOUND");
  });

  it("allows the owner to view their own cancelled listing", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const { listingId } = await seedListing(app, seller.accountId, itemDefId, {
      status: "cancelled",
    });
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "GET",
      url: `/api/marketplace/listings/${listingId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<ListingReply>().status).toBe("cancelled");
  });

  it("lazily expires an active listing that is past its expiry and returns the item to stash", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const { listingId, inventoryItemId } = await seedListing(app, seller.accountId, itemDefId, {
      expiresInHours: -1,
    });
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "GET",
      url: `/api/marketplace/listings/${listingId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<ListingReply>().status).toBe("expired");

    const item = await app.db.query<{ location_type: string }>(
      `select location_type from greyline_be.inventory_items where id = $1`,
      [inventoryItemId],
    );
    expect(item.rows[0].location_type).toBe("stash");
  });

  it("returns 404 for a nonexistent listing id", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "GET",
      url: `/api/marketplace/listings/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>().error.code).toBe("LISTING_NOT_FOUND");
  });

  it("returns 401 without a valid token", async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: `/api/marketplace/listings/${randomUUID()}`,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/marketplace/listings/:id/cancel", () => {
  it("cancels an active listing and returns the item to stash", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const { listingId, inventoryItemId } = await seedListing(app, seller.accountId, itemDefId);
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "POST",
      url: `/api/marketplace/listings/${listingId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ListingReply>();
    expect(body.status).toBe("cancelled");
    expect(body.cancelledAt).not.toBeNull();

    const item = await app.db.query<{ location_type: string }>(
      `select location_type from greyline_be.inventory_items where id = $1`,
      [inventoryItemId],
    );
    expect(item.rows[0].location_type).toBe("stash");
  });

  it("returns 404 for a nonexistent listing", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "POST",
      url: `/api/marketplace/listings/${randomUUID()}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>().error.code).toBe("LISTING_NOT_FOUND");
  });

  it("returns 404 when the caller does not own the listing", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const other = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const { listingId } = await seedListing(app, seller.accountId, itemDefId);
    const token = await loginAndGetToken(app, other);

    const res = await app.inject({
      method: "POST",
      url: `/api/marketplace/listings/${listingId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>().error.code).toBe("LISTING_NOT_FOUND");
  });

  it("returns 409 when the listing is already cancelled", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const { listingId } = await seedListing(app, seller.accountId, itemDefId, {
      status: "cancelled",
    });
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "POST",
      url: `/api/marketplace/listings/${listingId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>().error.code).toBe("LISTING_NOT_ACTIVE");
  });

  it("returns 409 LISTING_EXPIRED and still returns the item when the listing already expired", async () => {
    const app = createApp();
    const seller = await seedAccount(app);
    const itemDefId = await seedItemDef(app);
    const { listingId, inventoryItemId } = await seedListing(app, seller.accountId, itemDefId, {
      expiresInHours: -1,
    });
    const token = await loginAndGetToken(app, seller);

    const res = await app.inject({
      method: "POST",
      url: `/api/marketplace/listings/${listingId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>().error.code).toBe("LISTING_EXPIRED");

    const listingRow = await app.db.query<{ status: string }>(
      `select status from greyline_be.marketplace_listings where id = $1`,
      [listingId],
    );
    expect(listingRow.rows[0].status).toBe("expired");

    const item = await app.db.query<{ location_type: string }>(
      `select location_type from greyline_be.inventory_items where id = $1`,
      [inventoryItemId],
    );
    expect(item.rows[0].location_type).toBe("stash");
  });

  it("returns 401 without a valid token", async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: `/api/marketplace/listings/${randomUUID()}/cancel`,
    });

    expect(res.statusCode).toBe(401);
  });
});
