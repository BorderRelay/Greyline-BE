import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { AppError } from "../lib/app-error.js";

export type ListingStatus = "active" | "sold" | "cancelled" | "expired";

export const LISTING_DURATION_HOURS = [12, 24, 48] as const;
export type ListingDurationHours = (typeof LISTING_DURATION_HOURS)[number];

// Sale-fee-only policy per marketplace-system-spec.md §15-16: a flat percentage
// deducted from the seller's proceeds at purchase time. Stored on the listing so
// the (separate) purchase flow settles against the rate that was in effect when
// the listing was created.
export const DEFAULT_FEE_POLICY_TYPE = "percentage";
export const DEFAULT_FEE_RATE_BPS = 500; // 5%

export type CreateListingInput = {
  inventoryItemId: string;
  quantity: number;
  unitPrice: number;
  durationHours: ListingDurationHours;
};

export type ListingSummary = {
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
  status: ListingStatus;
  expiresAt: string;
  cancelledAt: string | null;
  soldAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListingRow = {
  id: string;
  seller_account_id: string;
  inventory_item_id: string;
  item_definition_id: string;
  quantity: number;
  listed_unit_price: string;
  total_listed_price: string;
  fee_policy_type: string;
  fee_rate_bps: number | null;
  fee_flat_amount: string | null;
  status: ListingStatus;
  expires_at: Date;
  cancelled_at: Date | null;
  sold_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type ItemDefRow = {
  name: string;
  type: string;
};

function toSummary(row: ListingRow, def: ItemDefRow): ListingSummary {
  return {
    listingId: row.id,
    sellerAccountId: row.seller_account_id,
    inventoryItemId: row.inventory_item_id,
    itemDefinitionId: row.item_definition_id,
    itemName: def.name,
    itemType: def.type,
    quantity: row.quantity,
    listedUnitPrice: Number(row.listed_unit_price),
    totalListedPrice: Number(row.total_listed_price),
    feePolicyType: row.fee_policy_type,
    feeRateBps: row.fee_rate_bps,
    feeFlatAmount: row.fee_flat_amount === null ? null : Number(row.fee_flat_amount),
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
    soldAt: row.sold_at ? row.sold_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const LISTING_COLUMNS = `
  id, seller_account_id, inventory_item_id, item_definition_id, quantity,
  listed_unit_price::text as listed_unit_price,
  total_listed_price::text as total_listed_price,
  fee_policy_type, fee_rate_bps,
  fee_flat_amount::text as fee_flat_amount,
  status, expires_at, cancelled_at, sold_at, created_at, updated_at
`;

async function fetchItemDef(
  client: PoolClient,
  itemDefinitionId: string,
): Promise<
  (ItemDefRow & { weight: string; stackable: boolean; marketplace_policy: string }) | null
> {
  const result = await client.query<
    ItemDefRow & { weight: string; stackable: boolean; marketplace_policy: string }
  >(
    `select name, type, weight::text as weight, stackable, marketplace_policy
     from greyline_be.item_definitions
     where id = $1`,
    [itemDefinitionId],
  );
  return result.rows[0] ?? null;
}

/**
 * Lazily transitions a single active-but-past-expiry listing to 'expired' and
 * returns its escrowed item to the seller's stash. Caller must already hold a
 * row lock (FOR UPDATE) on the listing.
 */
async function expireListing(
  client: PoolClient,
  listingId: string,
  inventoryItemId: string,
): Promise<void> {
  await client.query(
    `update greyline_be.inventory_items
     set location_type = 'stash', updated_at = now()
     where id = $1 and location_type = 'marketplace_escrow'`,
    [inventoryItemId],
  );
  await client.query(
    `update greyline_be.marketplace_listings
     set status = 'expired', updated_at = now()
     where id = $1`,
    [listingId],
  );
}

/**
 * Bulk lazy-expiration sweep used by read paths (browse / seller listing) so
 * stale 'active' rows never leak past their expires_at into results.
 */
export async function sweepExpiredListings(db: Pool): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");

    const expired = await client.query<{ id: string; inventory_item_id: string }>(
      `select id, inventory_item_id
       from greyline_be.marketplace_listings
       where status = 'active' and expires_at <= now()
       for update skip locked`,
    );

    for (const row of expired.rows) {
      await expireListing(client, row.id, row.inventory_item_id);
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function createListing(
  db: Pool,
  accountId: string,
  input: CreateListingInput,
): Promise<ListingSummary> {
  const client = await db.connect();
  try {
    await client.query("begin");

    const itemResult = await client.query<{
      id: string;
      item_definition_id: string;
      quantity: number;
      location_type: string;
    }>(
      `select id, item_definition_id, quantity, location_type
       from greyline_be.inventory_items
       where id = $1 and account_id = $2
       for update`,
      [input.inventoryItemId, accountId],
    );

    if (itemResult.rowCount === 0) {
      throw new AppError(
        404,
        "ITEM_NOT_FOUND",
        `Inventory item not found: ${input.inventoryItemId}.`,
      );
    }

    const item = itemResult.rows[0];

    if (item.location_type !== "stash") {
      throw new AppError(
        409,
        "ITEM_NOT_IN_STASH",
        `Item must be in stash to list on the marketplace: ${input.inventoryItemId}.`,
      );
    }

    if (input.quantity > item.quantity) {
      throw new AppError(
        422,
        "INSUFFICIENT_QUANTITY",
        `Insufficient quantity for item: ${input.inventoryItemId}.`,
      );
    }

    const def = await fetchItemDef(client, item.item_definition_id);
    if (!def) {
      throw new AppError(
        422,
        "ITEM_DEFINITION_NOT_FOUND",
        `Unknown item definition id: ${item.item_definition_id}.`,
      );
    }

    if (def.marketplace_policy !== "tradable") {
      throw new AppError(
        422,
        "ITEM_NOT_TRADABLE",
        `Item is not tradable on the marketplace: ${item.item_definition_id}.`,
      );
    }

    if (!def.stackable && input.quantity !== item.quantity) {
      throw new AppError(
        422,
        "INVALID_LISTING_QUANTITY",
        "Non-stackable items must be listed in full.",
      );
    }

    let escrowInventoryItemId: string;

    if (input.quantity === item.quantity) {
      escrowInventoryItemId = item.id;
      await client.query(
        `update greyline_be.inventory_items
         set location_type = 'marketplace_escrow', updated_at = now()
         where id = $1`,
        [item.id],
      );
    } else {
      escrowInventoryItemId = randomUUID();
      await client.query(
        `insert into greyline_be.inventory_items
           (id, account_id, item_definition_id, quantity, location_type)
         values ($1, $2, $3, $4, 'marketplace_escrow')`,
        [escrowInventoryItemId, accountId, item.item_definition_id, input.quantity],
      );
      await client.query(
        `update greyline_be.inventory_items
         set quantity = $2, updated_at = now()
         where id = $1`,
        [item.id, item.quantity - input.quantity],
      );
    }

    const listingId = randomUUID();
    const totalListedPrice = input.unitPrice * input.quantity;

    const insertResult = await client.query<ListingRow>(
      `insert into greyline_be.marketplace_listings
         (id, seller_account_id, inventory_item_id, item_definition_id, quantity,
          listed_unit_price, total_listed_price, fee_policy_type, fee_rate_bps,
          fee_flat_amount, status, expires_at, created_at, updated_at)
       values
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, null, 'active',
          now() + ($10::int * interval '1 hour'), now(), now())
       returning ${LISTING_COLUMNS}`,
      [
        listingId,
        accountId,
        escrowInventoryItemId,
        item.item_definition_id,
        input.quantity,
        input.unitPrice,
        totalListedPrice,
        DEFAULT_FEE_POLICY_TYPE,
        DEFAULT_FEE_RATE_BPS,
        input.durationHours,
      ],
    );

    await client.query("commit");

    return toSummary(insertResult.rows[0], def);
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function cancelListing(
  db: Pool,
  accountId: string,
  listingId: string,
): Promise<ListingSummary> {
  const client = await db.connect();
  try {
    await client.query("begin");

    const listingResult = await client.query<ListingRow>(
      `select ${LISTING_COLUMNS}
       from greyline_be.marketplace_listings
       where id = $1
       for update`,
      [listingId],
    );

    if (listingResult.rowCount === 0) {
      throw new AppError(404, "LISTING_NOT_FOUND", `Listing not found: ${listingId}.`);
    }

    const listing = listingResult.rows[0];

    // Hide existence of listings owned by another account, mirroring the
    // sell-repository convention of treating cross-account access as not-found.
    if (listing.seller_account_id !== accountId) {
      throw new AppError(404, "LISTING_NOT_FOUND", `Listing not found: ${listingId}.`);
    }

    const isExpired = listing.status === "active" && listing.expires_at.getTime() <= Date.now();

    if (isExpired) {
      await expireListing(client, listing.id, listing.inventory_item_id);
      await client.query("commit");
      throw new AppError(
        409,
        "LISTING_EXPIRED",
        "This listing already expired and its item was returned to your stash.",
      );
    }

    if (listing.status !== "active") {
      throw new AppError(
        409,
        "LISTING_NOT_ACTIVE",
        `Listing is not active (status: ${listing.status}) and cannot be cancelled.`,
      );
    }

    await client.query(
      `update greyline_be.inventory_items
       set location_type = 'stash', updated_at = now()
       where id = $1 and location_type = 'marketplace_escrow'`,
      [listing.inventory_item_id],
    );

    const updateResult = await client.query<ListingRow>(
      `update greyline_be.marketplace_listings
       set status = 'cancelled', cancelled_at = now(), updated_at = now()
       where id = $1
       returning ${LISTING_COLUMNS}`,
      [listing.id],
    );

    const def = await fetchItemDef(client, listing.item_definition_id);
    if (!def) {
      throw new AppError(
        422,
        "ITEM_DEFINITION_NOT_FOUND",
        `Unknown item definition id: ${listing.item_definition_id}.`,
      );
    }

    await client.query("commit");

    return toSummary(updateResult.rows[0], def);
  } catch (err) {
    // The LISTING_EXPIRED branch above already committed its own mutation;
    // rollback here is then a harmless no-op on an already-closed transaction.
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function getListingById(
  db: Pool,
  listingId: string,
  requesterAccountId: string,
): Promise<ListingSummary> {
  const client = await db.connect();
  try {
    await client.query("begin");

    const listingResult = await client.query<ListingRow>(
      `select ${LISTING_COLUMNS}
       from greyline_be.marketplace_listings
       where id = $1
       for update`,
      [listingId],
    );

    if (listingResult.rowCount === 0) {
      throw new AppError(404, "LISTING_NOT_FOUND", `Listing not found: ${listingId}.`);
    }

    let listing = listingResult.rows[0];

    if (listing.status === "active" && listing.expires_at.getTime() <= Date.now()) {
      await expireListing(client, listing.id, listing.inventory_item_id);
      const refreshed = await client.query<ListingRow>(
        `select ${LISTING_COLUMNS} from greyline_be.marketplace_listings where id = $1`,
        [listing.id],
      );
      listing = refreshed.rows[0];
    }

    const isOwner = listing.seller_account_id === requesterAccountId;
    if (listing.status !== "active" && !isOwner) {
      throw new AppError(404, "LISTING_NOT_FOUND", `Listing not found: ${listingId}.`);
    }

    const def = await fetchItemDef(client, listing.item_definition_id);
    if (!def) {
      throw new AppError(
        422,
        "ITEM_DEFINITION_NOT_FOUND",
        `Unknown item definition id: ${listing.item_definition_id}.`,
      );
    }

    await client.query("commit");

    return toSummary(listing, def);
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type BrowseListingsFilter = {
  itemType?: string;
  sort: "newest" | "price_asc" | "price_desc";
  limit: number;
  offset: number;
};

export async function browseActiveListings(
  db: Pool,
  filter: BrowseListingsFilter,
): Promise<ListingSummary[]> {
  await sweepExpiredListings(db);

  const orderBy =
    filter.sort === "price_asc"
      ? "ml.listed_unit_price asc, ml.created_at desc"
      : filter.sort === "price_desc"
        ? "ml.listed_unit_price desc, ml.created_at desc"
        : "ml.created_at desc";

  const params: unknown[] = [];
  let where = `ml.status = 'active' and ml.expires_at > now()`;

  if (filter.itemType) {
    params.push(filter.itemType);
    where += ` and d.type = $${params.length}`;
  }

  params.push(filter.limit);
  const limitParam = `$${params.length}`;
  params.push(filter.offset);
  const offsetParam = `$${params.length}`;

  const result = await db.query<ListingRow & ItemDefRow>(
    `select
       ml.id, ml.seller_account_id, ml.inventory_item_id, ml.item_definition_id, ml.quantity,
       ml.listed_unit_price::text as listed_unit_price,
       ml.total_listed_price::text as total_listed_price,
       ml.fee_policy_type, ml.fee_rate_bps,
       ml.fee_flat_amount::text as fee_flat_amount,
       ml.status, ml.expires_at, ml.cancelled_at, ml.sold_at, ml.created_at, ml.updated_at,
       d.name, d.type
     from greyline_be.marketplace_listings ml
     join greyline_be.item_definitions d on d.id = ml.item_definition_id
     where ${where}
     order by ${orderBy}
     limit ${limitParam} offset ${offsetParam}`,
    params,
  );

  return result.rows.map((row) => toSummary(row, row));
}

export type ListMyListingsFilter = {
  status?: ListingStatus;
  limit: number;
  offset: number;
};

export async function listMyListings(
  db: Pool,
  accountId: string,
  filter: ListMyListingsFilter,
): Promise<ListingSummary[]> {
  await sweepExpiredListings(db);

  const params: unknown[] = [accountId];
  let where = `ml.seller_account_id = $1`;

  if (filter.status) {
    params.push(filter.status);
    where += ` and ml.status = $${params.length}`;
  }

  params.push(filter.limit);
  const limitParam = `$${params.length}`;
  params.push(filter.offset);
  const offsetParam = `$${params.length}`;

  const result = await db.query<ListingRow & ItemDefRow>(
    `select
       ml.id, ml.seller_account_id, ml.inventory_item_id, ml.item_definition_id, ml.quantity,
       ml.listed_unit_price::text as listed_unit_price,
       ml.total_listed_price::text as total_listed_price,
       ml.fee_policy_type, ml.fee_rate_bps,
       ml.fee_flat_amount::text as fee_flat_amount,
       ml.status, ml.expires_at, ml.cancelled_at, ml.sold_at, ml.created_at, ml.updated_at,
       d.name, d.type
     from greyline_be.marketplace_listings ml
     join greyline_be.item_definitions d on d.id = ml.item_definition_id
     where ${where}
     order by ml.created_at desc
     limit ${limitParam} offset ${offsetParam}`,
    params,
  );

  return result.rows.map((row) => toSummary(row, row));
}
