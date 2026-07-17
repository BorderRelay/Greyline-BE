import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { AppError } from "../lib/app-error.js";
import { DEFAULT_FEE_POLICY_TYPE } from "./marketplace.repository.js";

export type PurchaseListingResult = {
  purchaseId: string;
  listingId: string;
  itemDefinitionId: string;
  quantity: number;
  grossPrice: number;
  feeAmount: number;
  sellerNetAmount: number;
  money: number;
  item: {
    inventoryItemId: string;
    itemDefinitionId: string;
    quantity: number;
  };
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
  status: string;
  expires_at: Date;
};

type ProfileRow = {
  account_id: string;
  money: string;
};

type EscrowItemRow = {
  id: string;
  account_id: string;
  item_definition_id: string;
  quantity: number;
  location_type: string;
  loaded_ammo_count: number | null;
};

type ItemDefinitionRow = {
  id: string;
  stackable: boolean;
};

function calculateFee(listing: ListingRow): bigint {
  const gross = BigInt(listing.total_listed_price);
  let fee: bigint;

  switch (listing.fee_policy_type) {
    case "flat":
      fee = listing.fee_flat_amount !== null ? BigInt(listing.fee_flat_amount) : 0n;
      break;
    // Listings are always created with DEFAULT_FEE_POLICY_TYPE ("percentage"; see
    // marketplace.repository.ts) and a fee_rate_bps in basis points. "flat" is kept
    // above for forward-compatibility even though nothing produces it today.
    case DEFAULT_FEE_POLICY_TYPE: {
      const rateBps = BigInt(listing.fee_rate_bps ?? 0);
      fee = (gross * rateBps) / 10000n;
      break;
    }
    default:
      fee = 0n;
  }

  if (fee < 0n) return 0n;
  if (fee > gross) return gross;
  return fee;
}

async function lockListing(client: PoolClient, listingId: string): Promise<ListingRow> {
  const result = await client.query<ListingRow>(
    `select id, seller_account_id, inventory_item_id, item_definition_id, quantity,
            listed_unit_price::text as listed_unit_price,
            total_listed_price::text as total_listed_price,
            fee_policy_type, fee_rate_bps,
            fee_flat_amount::text as fee_flat_amount,
            status, expires_at
     from greyline_be.marketplace_listings
     where id = $1
     for update`,
    [listingId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, "LISTING_NOT_FOUND", `Listing not found: ${listingId}.`);
  }

  return result.rows[0];
}

async function lockProfile(client: PoolClient, accountId: string): Promise<ProfileRow> {
  const result = await client.query<ProfileRow>(
    `select account_id, money::text as money
     from greyline_be.account_profiles
     where account_id = $1
     for update`,
    [accountId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, "ACCOUNT_NOT_FOUND", `Account profile not found: ${accountId}.`);
  }

  return result.rows[0];
}

async function lockEscrowItem(client: PoolClient, listing: ListingRow): Promise<EscrowItemRow> {
  const result = await client.query<EscrowItemRow>(
    `select id, account_id, item_definition_id, quantity, location_type, loaded_ammo_count
     from greyline_be.inventory_items
     where id = $1
     for update`,
    [listing.inventory_item_id],
  );

  const row = result.rows[0];

  if (
    !row ||
    row.location_type !== "marketplace_escrow" ||
    row.account_id !== listing.seller_account_id
  ) {
    throw new AppError(
      409,
      "ESCROW_ITEM_INVALID",
      "The escrowed item backing this listing is no longer valid.",
    );
  }

  return row;
}

/**
 * Transfers the escrowed inventory item to the buyer's stash.
 *
 * The escrowed row's id can never be deleted here: `marketplace_listings.inventory_item_id`
 * has a foreign key into `inventory_items` with no cascade, and that reference must stay
 * valid forever (it is the permanent audit trail for the listing, sold or not). So the
 * escrow row is always the row that survives — it is re-pointed at the buyer's stash.
 *
 * Stackable items with no per-instance state (e.g. loaded ammo count) are merged with an
 * existing compatible stash stack when one exists: the buyer's pre-existing stack (which
 * carries no such FK reference) is folded into the escrow row's quantity and then deleted.
 * Everything else (weapons, items carrying instance state, or stackables with no existing
 * stack) is transferred in place with its original quantity.
 */
async function transferItemToBuyer(
  client: PoolClient,
  buyerAccountId: string,
  escrowItem: EscrowItemRow,
): Promise<string> {
  const defResult = await client.query<ItemDefinitionRow>(
    `select id, stackable from greyline_be.item_definitions where id = $1`,
    [escrowItem.item_definition_id],
  );
  const stackable = defResult.rows[0]?.stackable ?? false;
  const hasInstanceState = escrowItem.loaded_ammo_count !== null;

  if (stackable && !hasInstanceState) {
    const existingStashResult = await client.query<{ id: string; quantity: number }>(
      `select id, quantity
       from greyline_be.inventory_items
       where account_id = $1 and item_definition_id = $2 and location_type = 'stash'
       for update`,
      [buyerAccountId, escrowItem.item_definition_id],
    );

    if (existingStashResult.rowCount && existingStashResult.rowCount > 0) {
      const existing = existingStashResult.rows[0];
      const mergedQuantity = existing.quantity + escrowItem.quantity;

      await client.query(
        `update greyline_be.inventory_items
         set account_id = $2, location_type = 'stash', location_ref = null,
             quantity = $3, updated_at = now()
         where id = $1`,
        [escrowItem.id, buyerAccountId, mergedQuantity],
      );
      await client.query(`delete from greyline_be.inventory_items where id = $1`, [existing.id]);

      return escrowItem.id;
    }
  }

  await client.query(
    `update greyline_be.inventory_items
     set account_id = $2, location_type = 'stash', location_ref = null, updated_at = now()
     where id = $1`,
    [escrowItem.id, buyerAccountId],
  );

  return escrowItem.id;
}

export async function purchaseListing(
  db: Pool,
  buyerAccountId: string,
  listingId: string,
): Promise<PurchaseListingResult> {
  const client = await db.connect();
  try {
    await client.query("begin");

    const listing = await lockListing(client, listingId);

    if (listing.seller_account_id === buyerAccountId) {
      throw new AppError(403, "SELF_PURCHASE_NOT_ALLOWED", "You cannot purchase your own listing.");
    }

    if (listing.status === "active" && listing.expires_at.getTime() <= Date.now()) {
      await client.query(
        `update greyline_be.marketplace_listings
         set status = 'expired', updated_at = now()
         where id = $1`,
        [listing.id],
      );
      await client.query("commit");
      throw new AppError(409, "LISTING_EXPIRED", "This listing has expired.");
    }

    if (listing.status !== "active") {
      throw new AppError(
        409,
        "LISTING_NOT_ACTIVE",
        `Listing is not active (status: ${listing.status}).`,
      );
    }

    // Lock buyer + seller profiles in a deterministic (account id ascending) order
    // so two concurrent purchases that involve the same two accounts as buyer/seller
    // in opposite roles cannot deadlock on the profile row locks.
    const [firstAccountId, secondAccountId] = [buyerAccountId, listing.seller_account_id].sort();
    const firstProfile = await lockProfile(client, firstAccountId);
    const secondProfile = await lockProfile(client, secondAccountId);
    const profileByAccountId = new Map([
      [firstAccountId, firstProfile],
      [secondAccountId, secondProfile],
    ]);

    const buyerProfile = profileByAccountId.get(buyerAccountId)!;
    const sellerProfile = profileByAccountId.get(listing.seller_account_id)!;

    const escrowItem = await lockEscrowItem(client, listing);

    const grossPrice = BigInt(listing.total_listed_price);
    const buyerMoney = BigInt(buyerProfile.money);

    if (buyerMoney < grossPrice) {
      throw new AppError(422, "INSUFFICIENT_FUNDS", "Insufficient funds to purchase this listing.");
    }

    const feeAmount = calculateFee(listing);
    const sellerNetAmount = grossPrice - feeAmount;
    const sellerMoney = BigInt(sellerProfile.money);

    const newBuyerMoney = buyerMoney - grossPrice;
    const newSellerMoney = sellerMoney + sellerNetAmount;

    await client.query(
      `update greyline_be.account_profiles set money = $2, updated_at = now() where account_id = $1`,
      [buyerAccountId, newBuyerMoney.toString()],
    );
    await client.query(
      `update greyline_be.account_profiles set money = $2, updated_at = now() where account_id = $1`,
      [listing.seller_account_id, newSellerMoney.toString()],
    );

    const inventoryItemId = await transferItemToBuyer(client, buyerAccountId, escrowItem);

    const purchaseId = randomUUID();
    await client.query(
      `insert into greyline_be.marketplace_purchases
         (id, listing_id, seller_account_id, buyer_account_id, gross_price, fee_amount, seller_net_amount, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())`,
      [
        purchaseId,
        listing.id,
        listing.seller_account_id,
        buyerAccountId,
        grossPrice.toString(),
        feeAmount.toString(),
        sellerNetAmount.toString(),
      ],
    );

    await client.query(
      `insert into greyline_be.marketplace_purchase_items
         (id, marketplace_purchase_id, item_definition_id, quantity, unit_price, total_price, created_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [
        randomUUID(),
        purchaseId,
        listing.item_definition_id,
        listing.quantity,
        listing.listed_unit_price,
        grossPrice.toString(),
      ],
    );

    await client.query(
      `update greyline_be.marketplace_listings
       set status = 'sold', sold_at = now(), updated_at = now()
       where id = $1`,
      [listing.id],
    );

    await client.query("commit");

    return {
      purchaseId,
      listingId: listing.id,
      itemDefinitionId: listing.item_definition_id,
      quantity: listing.quantity,
      grossPrice: Number(grossPrice),
      feeAmount: Number(feeAmount),
      sellerNetAmount: Number(sellerNetAmount),
      money: Number(newBuyerMoney),
      item: {
        inventoryItemId,
        itemDefinitionId: listing.item_definition_id,
        quantity: listing.quantity,
      },
    };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
