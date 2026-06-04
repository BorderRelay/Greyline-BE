import type { Pool } from "pg";

export type StashItemRow = {
  inventory_item_id: string;
  item_definition_id: string;
  quantity: number;
  loaded_ammo_count: number | null;
  name: string;
  type: string;
  weight: string;
  base_value: number;
  stackable: boolean;
  max_stack: number;
};

export type StashRow = {
  money: string;
  items: StashItemRow[];
};

export async function getStash(db: Pool, accountId: string): Promise<StashRow> {
  const result = await db.query<{ money: string } & Partial<StashItemRow>>(
    `select
       p.money::text as money,
       ii.id          as inventory_item_id,
       ii.item_definition_id,
       ii.quantity,
       ii.loaded_ammo_count,
       d.name,
       d.type,
       d.weight::text as weight,
       d.base_value,
       d.stackable,
       d.max_stack
     from greyline_be.account_profiles p
     left join greyline_be.inventory_items ii
       on ii.account_id = p.account_id
      and ii.location_type = 'stash'
     left join greyline_be.item_definitions d
       on d.id = ii.item_definition_id
     where p.account_id = $1
     order by d.type, d.name, ii.created_at`,
    [accountId],
  );

  if (result.rows.length === 0) {
    return { money: "0", items: [] };
  }

  const money = result.rows[0].money;
  const items: StashItemRow[] = result.rows
    .filter((row) => row.inventory_item_id != null)
    .map((row) => ({
      inventory_item_id: row.inventory_item_id!,
      item_definition_id: row.item_definition_id!,
      quantity: row.quantity!,
      loaded_ammo_count: row.loaded_ammo_count ?? null,
      name: row.name!,
      type: row.type!,
      weight: row.weight!,
      base_value: row.base_value!,
      stackable: row.stackable!,
      max_stack: row.max_stack!,
    }));

  return { money, items };
}
