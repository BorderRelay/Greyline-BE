import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { AppError } from "../lib/app-error.js";

export type SellItemRequest = {
  inventoryItemId: string;
  quantity: number;
};

export type SoldLine = {
  inventoryItemId: string;
  itemDefinitionId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

export type SellResult = {
  saleId: string;
  totalPrice: number;
  money: number;
  sold: SoldLine[];
};

type StatusCodes = {
  notFound: number;
  notInStash: number;
  insufficientQuantity: number;
};

const SINGLE_SELL_STATUS_CODES: StatusCodes = {
  notFound: 404,
  notInStash: 409,
  insufficientQuantity: 422,
};

const BULK_SELL_STATUS_CODES: StatusCodes = {
  notFound: 422,
  notInStash: 422,
  insufficientQuantity: 422,
};

type LockedInventoryRow = {
  id: string;
  item_definition_id: string;
  quantity: number;
  location_type: string;
};

type ItemDefinitionRow = {
  id: string;
  base_value: number;
};

export async function sellSingleItem(
  db: Pool,
  accountId: string,
  inventoryItemId: string,
  quantity: number,
): Promise<SellResult> {
  return sell(db, accountId, [{ inventoryItemId, quantity }], SINGLE_SELL_STATUS_CODES);
}

export async function sellBulkItems(
  db: Pool,
  accountId: string,
  items: SellItemRequest[],
): Promise<SellResult> {
  if (items.length === 0) {
    throw new AppError(400, "EMPTY_SALE_ITEMS", "At least one item is required.");
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.inventoryItemId)) {
      throw new AppError(
        400,
        "DUPLICATE_SALE_ITEMS",
        `Duplicate inventoryItemId in request: ${item.inventoryItemId}.`,
      );
    }
    seen.add(item.inventoryItemId);
  }

  return sell(db, accountId, items, BULK_SELL_STATUS_CODES);
}

async function sell(
  db: Pool,
  accountId: string,
  items: SellItemRequest[],
  statusCodes: StatusCodes,
): Promise<SellResult> {
  const client = await db.connect();
  try {
    await client.query("begin");

    const profileResult = await client.query<{ money: string }>(
      `select money::text as money
       from greyline_be.account_profiles
       where account_id = $1
       for update`,
      [accountId],
    );

    if (profileResult.rowCount === 0) {
      throw new AppError(404, "ACCOUNT_NOT_FOUND", "Account profile not found.");
    }

    const currentMoney = BigInt(profileResult.rows[0].money);

    const inventoryItemIds = items.map((item) => item.inventoryItemId);
    const lockedResult = await client.query<LockedInventoryRow>(
      `select id, item_definition_id, quantity, location_type
       from greyline_be.inventory_items
       where account_id = $1 and id = any($2::uuid[])
       for update`,
      [accountId, inventoryItemIds],
    );

    const lockedById = new Map(lockedResult.rows.map((row) => [row.id, row]));

    for (const item of items) {
      const row = lockedById.get(item.inventoryItemId);

      if (!row) {
        throw new AppError(
          statusCodes.notFound,
          "ITEM_NOT_FOUND",
          `Inventory item not found: ${item.inventoryItemId}.`,
        );
      }

      if (row.location_type !== "stash") {
        throw new AppError(
          statusCodes.notInStash,
          "ITEM_NOT_IN_STASH",
          `Item must be in stash to sell: ${item.inventoryItemId}.`,
        );
      }

      if (item.quantity > row.quantity) {
        throw new AppError(
          statusCodes.insufficientQuantity,
          "INSUFFICIENT_QUANTITY",
          `Insufficient quantity for item: ${item.inventoryItemId}.`,
        );
      }
    }

    const itemDefinitionIds = [...new Set(lockedResult.rows.map((row) => row.item_definition_id))];
    const defResult = await client.query<ItemDefinitionRow>(
      `select id, base_value
       from greyline_be.item_definitions
       where id = any($1::text[])`,
      [itemDefinitionIds],
    );
    const priceByDefinitionId = new Map(defResult.rows.map((row) => [row.id, row.base_value]));

    const sold: SoldLine[] = items.map((item) => {
      const row = lockedById.get(item.inventoryItemId)!;
      const unitPrice = priceByDefinitionId.get(row.item_definition_id) ?? 0;
      const totalPrice = unitPrice * item.quantity;
      return {
        inventoryItemId: item.inventoryItemId,
        itemDefinitionId: row.item_definition_id,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
      };
    });

    const totalPrice = sold.reduce((sum, line) => sum + line.totalPrice, 0);
    const saleId = randomUUID();

    await client.query(
      `insert into greyline_be.npc_sales (id, account_id, total_price, created_at)
       values ($1, $2, $3, now())`,
      [saleId, accountId, totalPrice],
    );

    for (const line of sold) {
      await client.query(
        `insert into greyline_be.npc_sale_items
           (id, npc_sale_id, item_definition_id, quantity, unit_price, total_price, created_at)
         values ($1, $2, $3, $4, $5, $6, now())`,
        [
          randomUUID(),
          saleId,
          line.itemDefinitionId,
          line.quantity,
          line.unitPrice,
          line.totalPrice,
        ],
      );
    }

    for (const item of items) {
      const row = lockedById.get(item.inventoryItemId)!;
      const remaining = row.quantity - item.quantity;

      if (remaining === 0) {
        await deleteInventoryItem(client, item.inventoryItemId);
      } else {
        await decrementInventoryItem(client, item.inventoryItemId, remaining);
      }
    }

    const newMoney = currentMoney + BigInt(totalPrice);

    await client.query(
      `update greyline_be.account_profiles
       set money = $2, updated_at = now()
       where account_id = $1`,
      [accountId, newMoney.toString()],
    );

    await client.query("commit");

    return {
      saleId,
      totalPrice,
      money: Number(newMoney),
      sold,
    };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function deleteInventoryItem(client: PoolClient, inventoryItemId: string): Promise<void> {
  await client.query(`delete from greyline_be.inventory_items where id = $1`, [inventoryItemId]);
}

async function decrementInventoryItem(
  client: PoolClient,
  inventoryItemId: string,
  remainingQuantity: number,
): Promise<void> {
  await client.query(
    `update greyline_be.inventory_items
     set quantity = $2, updated_at = now()
     where id = $1`,
    [inventoryItemId, remainingQuantity],
  );
}
