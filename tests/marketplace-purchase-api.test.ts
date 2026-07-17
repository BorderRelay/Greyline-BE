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

type PurchaseReply = {
  ok: boolean;
  money: number;
  purchase: {
    purchaseId: string;
    listingId: string;
    itemDefinitionId: string;
    quantity: number;
    grossPrice: number;
    feeAmount: number;
    sellerNetAmount: number;
  };
  item: {
    inventoryItemId: string;
    itemDefinitionId: string;
    quantity: number;
  };
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

async function seedAccount(app: ReturnType<typeof buildApp>, money = 1000) {
  await app.ready();
  const accountId = randomUUID();
  const email = `market-buy-${accountId}@example.com`;
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

async function seedEscrowItem(
  app: ReturnType<typeof buildApp>,
  sellerAccountId: string,
  itemDefinitionId: string,
  quantity = 1,
  loadedAmmoCount: number | null = null,
) {
  const id = randomUUID();
  await app.db.query(
    `insert into greyline_be.inventory_items
       (id, account_id, item_definition_id, quantity, location_type, loaded_ammo_count)
     values ($1, $2, $3, $4, 'marketplace_escrow', $5)`,
    [id, sellerAccountId, itemDefinitionId, quantity, loadedAmmoCount],
  );
  return id;
}

async function seedListing(
  app: ReturnType<typeof buildApp>,
  params: {
    sellerAccountId: string;
    inventoryItemId: string;
    itemDefinitionId: string;
    quantity?: number;
    unitPrice?: number;
    feePolicyType?: string;
    feeRateBps?: number | null;
    feeFlatAmount?: number | null;
    status?: string;
    expiresAt?: Date;
  },
) {
  const id = randomUUID();
  const quantity = params.quantity ?? 1;
  const unitPrice = params.unitPrice ?? 100;
  const totalPrice = unitPrice * quantity;

  await app.db.query(
    `insert into greyline_be.marketplace_listings
       (id, seller_account_id, inventory_item_id, item_definition_id, quantity,
        listed_unit_price, total_listed_price, fee_policy_type, fee_rate_bps, fee_flat_amount,
        status, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      params.sellerAccountId,
      params.inventoryItemId,
      params.itemDefinitionId,
      quantity,
      unitPrice,
      totalPrice,
      params.feePolicyType ?? "percentage",
      params.feeRateBps ?? 1000,
      params.feeFlatAmount ?? null,
      params.status ?? "active",
      params.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    ],
  );

  return { id, unitPrice, totalPrice };
}

async function seedInventoryItem(
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

function purchase(app: ReturnType<typeof buildApp>, token: string, listingId: string) {
  return app.inject({
    method: "POST",
    url: "/api/marketplace/purchases",
    headers: { authorization: `Bearer ${token}` },
    payload: { listingId },
  });
}

afterEach(async () => {
  // purchases -> listings -> accounts (cascades to inventory_items) -> item_definitions
  for (const [app, ids] of createdAccountIds.entries()) {
    if (ids.length > 0) {
      await app.db.query(
        `delete from greyline_be.marketplace_purchases
         where seller_account_id = any($1::uuid[]) or buyer_account_id = any($1::uuid[])`,
        [ids],
      );
      await app.db.query(
        `delete from greyline_be.marketplace_listings where seller_account_id = any($1::uuid[])`,
        [ids],
      );
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

describe("POST /api/marketplace/purchases", () => {
  it("purchases an active listing, settling funds and transferring the item", async () => {
    const app = createApp();
    const seller = await seedAccount(app, 0);
    const buyer = await seedAccount(app, 1000);
    const itemDefId = await seedItemDef(app, { name: "Gold Watch", base_value: 300 });
    const escrowItemId = await seedEscrowItem(app, seller.accountId, itemDefId, 1);
    const listing = await seedListing(app, {
      sellerAccountId: seller.accountId,
      inventoryItemId: escrowItemId,
      itemDefinitionId: itemDefId,
      unitPrice: 500,
      feePolicyType: "percentage",
      feeRateBps: 1000, // 10%
    });
    const token = await loginAndGetToken(app, buyer);

    const res = await purchase(app, token, listing.id);

    expect(res.statusCode).toBe(200);
    const body = res.json<PurchaseReply>();
    expect(body.ok).toBe(true);
    expect(body.money).toBe(500); // 1000 - 500
    expect(body.purchase).toMatchObject({
      listingId: listing.id,
      itemDefinitionId: itemDefId,
      quantity: 1,
      grossPrice: 500,
      feeAmount: 50,
      sellerNetAmount: 450,
    });
    expect(body.item).toMatchObject({ itemDefinitionId: itemDefId, quantity: 1 });

    const buyerProfile = await app.db.query<{ money: string }>(
      `select money::text as money from greyline_be.account_profiles where account_id = $1`,
      [buyer.accountId],
    );
    expect(buyerProfile.rows[0].money).toBe("500");

    const sellerProfile = await app.db.query<{ money: string }>(
      `select money::text as money from greyline_be.account_profiles where account_id = $1`,
      [seller.accountId],
    );
    expect(sellerProfile.rows[0].money).toBe("450");

    const item = await app.db.query<{ account_id: string; location_type: string }>(
      `select account_id, location_type from greyline_be.inventory_items where id = $1`,
      [escrowItemId],
    );
    expect(item.rows[0]).toMatchObject({
      account_id: buyer.accountId,
      location_type: "stash",
    });

    const listingRow = await app.db.query<{ status: string; sold_at: Date | null }>(
      `select status, sold_at from greyline_be.marketplace_listings where id = $1`,
      [listing.id],
    );
    expect(listingRow.rows[0].status).toBe("sold");
    expect(listingRow.rows[0].sold_at).not.toBeNull();

    const purchaseRow = await app.db.query(
      `select * from greyline_be.marketplace_purchases where id = $1`,
      [body.purchase.purchaseId],
    );
    expect(purchaseRow.rowCount).toBe(1);

    const purchaseItemRows = await app.db.query(
      `select * from greyline_be.marketplace_purchase_items where marketplace_purchase_id = $1`,
      [body.purchase.purchaseId],
    );
    expect(purchaseItemRows.rowCount).toBe(1);
  });

  it("merges stackable purchased items into an existing compatible stash stack", async () => {
    const app = createApp();
    const seller = await seedAccount(app, 0);
    const buyer = await seedAccount(app, 1000);
    const itemDefId = await seedItemDef(app, {
      name: "9mm Ammo",
      base_value: 5,
      stackable: true,
      max_stack: 200,
    });
    const buyerStashItemId = await seedInventoryItem(app, buyer.accountId, itemDefId, 20);
    const escrowItemId = await seedEscrowItem(app, seller.accountId, itemDefId, 30);
    const listing = await seedListing(app, {
      sellerAccountId: seller.accountId,
      inventoryItemId: escrowItemId,
      itemDefinitionId: itemDefId,
      quantity: 30,
      unitPrice: 5,
      feePolicyType: "none",
    });
    const token = await loginAndGetToken(app, buyer);

    const res = await purchase(app, token, listing.id);

    expect(res.statusCode).toBe(200);

    // The buyer's pre-existing stack is folded into the escrow row and removed. The
    // escrow row itself must survive (marketplace_listings.inventory_item_id still
    // references it) and becomes the buyer's merged stash stack.
    const buyerRowGone = await app.db.query(
      `select id from greyline_be.inventory_items where id = $1`,
      [buyerStashItemId],
    );
    expect(buyerRowGone.rowCount).toBe(0);

    const stashRows = await app.db.query<{
      quantity: number;
      account_id: string;
      location_type: string;
    }>(
      `select quantity, account_id, location_type from greyline_be.inventory_items
       where account_id = $1 and item_definition_id = $2 and location_type = 'stash'`,
      [buyer.accountId, itemDefId],
    );
    expect(stashRows.rowCount).toBe(1);
    expect(stashRows.rows[0].quantity).toBe(50);
    expect(stashRows.rows[0].account_id).toBe(buyer.accountId);

    const escrowRowNowStash = await app.db.query<{ id: string }>(
      `select id from greyline_be.inventory_items where id = $1`,
      [escrowItemId],
    );
    expect(escrowRowNowStash.rowCount).toBe(1);
  });

  it("returns 404 when the listing does not exist", async () => {
    const app = createApp();
    const buyer = await seedAccount(app);
    const token = await loginAndGetToken(app, buyer);

    const res = await purchase(app, token, randomUUID());

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>().error.code).toBe("LISTING_NOT_FOUND");
  });

  it("returns 403 when the buyer is the seller", async () => {
    const app = createApp();
    const seller = await seedAccount(app, 1000);
    const itemDefId = await seedItemDef(app);
    const escrowItemId = await seedEscrowItem(app, seller.accountId, itemDefId, 1);
    const listing = await seedListing(app, {
      sellerAccountId: seller.accountId,
      inventoryItemId: escrowItemId,
      itemDefinitionId: itemDefId,
    });
    const token = await loginAndGetToken(app, seller);

    const res = await purchase(app, token, listing.id);

    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorBody>().error.code).toBe("SELF_PURCHASE_NOT_ALLOWED");
  });

  it("returns 422 when the buyer has insufficient funds", async () => {
    const app = createApp();
    const seller = await seedAccount(app, 0);
    const buyer = await seedAccount(app, 100);
    const itemDefId = await seedItemDef(app);
    const escrowItemId = await seedEscrowItem(app, seller.accountId, itemDefId, 1);
    const listing = await seedListing(app, {
      sellerAccountId: seller.accountId,
      inventoryItemId: escrowItemId,
      itemDefinitionId: itemDefId,
      unitPrice: 500,
    });
    const token = await loginAndGetToken(app, buyer);

    const res = await purchase(app, token, listing.id);

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("INSUFFICIENT_FUNDS");

    const listingRow = await app.db.query<{ status: string }>(
      `select status from greyline_be.marketplace_listings where id = $1`,
      [listing.id],
    );
    expect(listingRow.rows[0].status).toBe("active");

    const buyerProfile = await app.db.query<{ money: string }>(
      `select money::text as money from greyline_be.account_profiles where account_id = $1`,
      [buyer.accountId],
    );
    expect(buyerProfile.rows[0].money).toBe("100");
  });

  it("returns 409 when the listing is already sold", async () => {
    const app = createApp();
    const seller = await seedAccount(app, 0);
    const buyer = await seedAccount(app, 1000);
    const itemDefId = await seedItemDef(app);
    const escrowItemId = await seedEscrowItem(app, seller.accountId, itemDefId, 1);
    const listing = await seedListing(app, {
      sellerAccountId: seller.accountId,
      inventoryItemId: escrowItemId,
      itemDefinitionId: itemDefId,
      status: "sold",
    });
    const token = await loginAndGetToken(app, buyer);

    const res = await purchase(app, token, listing.id);

    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>().error.code).toBe("LISTING_NOT_ACTIVE");
  });

  it("returns 409 when the listing was cancelled", async () => {
    const app = createApp();
    const seller = await seedAccount(app, 0);
    const buyer = await seedAccount(app, 1000);
    const itemDefId = await seedItemDef(app);
    const escrowItemId = await seedEscrowItem(app, seller.accountId, itemDefId, 1);
    const listing = await seedListing(app, {
      sellerAccountId: seller.accountId,
      inventoryItemId: escrowItemId,
      itemDefinitionId: itemDefId,
      status: "cancelled",
    });
    const token = await loginAndGetToken(app, buyer);

    const res = await purchase(app, token, listing.id);

    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>().error.code).toBe("LISTING_NOT_ACTIVE");
  });

  it("lazily expires and rejects a purchase on an active-but-expired listing", async () => {
    const app = createApp();
    const seller = await seedAccount(app, 0);
    const buyer = await seedAccount(app, 1000);
    const itemDefId = await seedItemDef(app);
    const escrowItemId = await seedEscrowItem(app, seller.accountId, itemDefId, 1);
    const listing = await seedListing(app, {
      sellerAccountId: seller.accountId,
      inventoryItemId: escrowItemId,
      itemDefinitionId: itemDefId,
      status: "active",
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    const token = await loginAndGetToken(app, buyer);

    const res = await purchase(app, token, listing.id);

    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>().error.code).toBe("LISTING_EXPIRED");

    const listingRow = await app.db.query<{ status: string }>(
      `select status from greyline_be.marketplace_listings where id = $1`,
      [listing.id],
    );
    expect(listingRow.rows[0].status).toBe("expired");
  });

  it("only allows one of two concurrent purchase attempts to succeed", async () => {
    const app = createApp();
    const seller = await seedAccount(app, 0);
    const buyerA = await seedAccount(app, 1000);
    const buyerB = await seedAccount(app, 1000);
    const itemDefId = await seedItemDef(app);
    const escrowItemId = await seedEscrowItem(app, seller.accountId, itemDefId, 1);
    const listing = await seedListing(app, {
      sellerAccountId: seller.accountId,
      inventoryItemId: escrowItemId,
      itemDefinitionId: itemDefId,
      unitPrice: 400,
      feePolicyType: "none",
    });
    const tokenA = await loginAndGetToken(app, buyerA);
    const tokenB = await loginAndGetToken(app, buyerB);

    const [resA, resB] = await Promise.all([
      purchase(app, tokenA, listing.id),
      purchase(app, tokenB, listing.id),
    ]);

    const statusCodes = [resA.statusCode, resB.statusCode].sort();
    expect(statusCodes).toEqual([200, 409]);

    const sellerProfile = await app.db.query<{ money: string }>(
      `select money::text as money from greyline_be.account_profiles where account_id = $1`,
      [seller.accountId],
    );
    expect(sellerProfile.rows[0].money).toBe("400");

    const listingRow = await app.db.query<{ status: string }>(
      `select status from greyline_be.marketplace_listings where id = $1`,
      [listing.id],
    );
    expect(listingRow.rows[0].status).toBe("sold");

    const purchaseRows = await app.db.query(
      `select id from greyline_be.marketplace_purchases where listing_id = $1`,
      [listing.id],
    );
    expect(purchaseRows.rowCount).toBe(1);
  });

  it("returns 401 without a valid token", async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/purchases",
      payload: { listingId: randomUUID() },
    });

    expect(res.statusCode).toBe(401);
  });
});
