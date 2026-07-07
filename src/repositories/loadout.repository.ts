import type { Pool, PoolClient } from "pg";

import { AppError } from "../lib/app-error.js";

export type LoadoutSlotRow = {
  slot_name: string;
  inventory_item_id: string | null;
  item_definition_id: string | null;
  quantity: number | null;
  loaded_ammo_count: number | null;
  name: string | null;
  type: string | null;
  ammo_type: string | null;
  weapon_class: string | null;
  magazine_size: number | null;
};

const SLOT_COMPATIBLE_TYPES: Record<string, string[]> = {
  primary_weapon: ["weapon"],
  secondary_weapon: ["weapon"],
  consumable_1: ["medical", "food"],
  consumable_2: ["medical", "food"],
};

export async function getLoadout(db: Pool, accountId: string): Promise<LoadoutSlotRow[]> {
  const result = await db.query<LoadoutSlotRow>(
    `select
       ls.slot_name,
       ii.id          as inventory_item_id,
       ii.item_definition_id,
       ii.quantity,
       ii.loaded_ammo_count,
       d.name,
       d.type,
       d.ammo_type,
       d.weapon_class,
       d.magazine_size
     from greyline_be.loadout_slots ls
     left join greyline_be.inventory_items ii
       on ii.id = ls.inventory_item_id
     left join greyline_be.item_definitions d
       on d.id = ii.item_definition_id
     where ls.account_id = $1
     order by ls.slot_name`,
    [accountId],
  );
  return result.rows;
}

export async function equipItem(
  db: Pool,
  accountId: string,
  inventoryItemId: string,
  slotName: string,
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");

    const itemResult = await client.query<{
      id: string;
      location_type: string;
      item_definition_id: string;
    }>(
      `select ii.id, ii.location_type, ii.item_definition_id
       from greyline_be.inventory_items ii
       where ii.id = $1 and ii.account_id = $2
       for update`,
      [inventoryItemId, accountId],
    );

    if (itemResult.rowCount === 0) {
      throw new AppError(404, "ITEM_NOT_FOUND", "Item not found.");
    }

    const item = itemResult.rows[0];

    if (item.location_type !== "stash") {
      throw new AppError(409, "ITEM_NOT_IN_STASH", "Item must be in stash to equip.");
    }

    const defResult = await client.query<{ type: string }>(
      `select type from greyline_be.item_definitions where id = $1`,
      [item.item_definition_id],
    );
    const itemType = defResult.rows[0]?.type;
    const allowed = SLOT_COMPATIBLE_TYPES[slotName];

    if (!allowed || !itemType || !allowed.includes(itemType)) {
      throw new AppError(
        422,
        "SLOT_TYPE_MISMATCH",
        `Item type '${itemType}' cannot be equipped in slot '${slotName}'.`,
      );
    }

    const slotResult = await client.query<{ inventory_item_id: string | null }>(
      `select inventory_item_id
       from greyline_be.loadout_slots
       where account_id = $1 and slot_name = $2
       for update`,
      [accountId, slotName],
    );

    const currentSlotItemId = slotResult.rows[0]?.inventory_item_id ?? null;

    if (currentSlotItemId) {
      await moveItemToStash(client, currentSlotItemId);
    }

    await client.query(
      `update greyline_be.inventory_items
       set location_type = 'loadout', updated_at = now()
       where id = $1`,
      [inventoryItemId],
    );

    await client.query(
      `update greyline_be.loadout_slots
       set inventory_item_id = $1, updated_at = now()
       where account_id = $2 and slot_name = $3`,
      [inventoryItemId, accountId, slotName],
    );

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function unequipItem(db: Pool, accountId: string, slotName: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");

    const slotResult = await client.query<{ inventory_item_id: string | null }>(
      `select inventory_item_id
       from greyline_be.loadout_slots
       where account_id = $1 and slot_name = $2
       for update`,
      [accountId, slotName],
    );

    if (slotResult.rowCount === 0) {
      throw new AppError(404, "SLOT_NOT_FOUND", "Slot not found.");
    }

    const inventoryItemId = slotResult.rows[0].inventory_item_id;

    if (!inventoryItemId) {
      throw new AppError(409, "SLOT_EMPTY", "Slot is already empty.");
    }

    await moveItemToStash(client, inventoryItemId);

    await client.query(
      `update greyline_be.loadout_slots
       set inventory_item_id = null, updated_at = now()
       where account_id = $1 and slot_name = $2`,
      [accountId, slotName],
    );

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function moveItemToStash(client: PoolClient, inventoryItemId: string): Promise<void> {
  await client.query(
    `update greyline_be.inventory_items
     set location_type = 'stash', updated_at = now()
     where id = $1`,
    [inventoryItemId],
  );
}
