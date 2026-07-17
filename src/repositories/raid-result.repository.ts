import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { AppError } from "../lib/app-error.js";

export type RaidResultOutcome = "success" | "failure";

export type DeathPosition = {
  x: number;
  y: number;
};

export type ExtractedItemInput = {
  itemDefinitionId: string;
  quantity: number;
};

export type RaidResultInput = {
  raidId: string;
  result: RaidResultOutcome;
  startedAt: string | null;
  endedAt: string;
  extractionPointId: string | null;
  deathPosition: DeathPosition | null;
  extractedItems: ExtractedItemInput[];
};

export type AcceptRaidResultOutcome = {
  accepted: true;
  raidId: string;
  result: RaidResultOutcome;
  stashUpdated: boolean;
};

type ExistingRaidResultRow = {
  id: string;
  account_id: string;
  result: RaidResultOutcome;
  death_x: string | null;
  death_y: string | null;
  extraction_point_id: string | null;
  started_at: Date | null;
  ended_at: Date;
};

type ExistingRaidResultItemRow = {
  item_definition_id: string;
  quantity: number;
};

function validateDomainRules(input: RaidResultInput): void {
  if (input.result === "success" && input.deathPosition !== null) {
    throw new AppError(
      422,
      "DEATH_POSITION_NOT_ALLOWED",
      "A successful raid result must not include a death position.",
    );
  }

  if (input.result === "failure" && input.extractedItems.length > 0) {
    throw new AppError(
      422,
      "EXTRACTED_ITEMS_NOT_ALLOWED",
      "A failed raid result must not include extracted items.",
    );
  }

  if (input.result === "failure" && input.deathPosition === null) {
    throw new AppError(
      422,
      "DEATH_POSITION_REQUIRED",
      "A failed raid result must include a death position.",
    );
  }
}

function normalizeItems(
  items: ExtractedItemInput[],
): Array<{ itemDefinitionId: string; quantity: number }> {
  const merged = new Map<string, number>();
  for (const item of items) {
    merged.set(item.itemDefinitionId, (merged.get(item.itemDefinitionId) ?? 0) + item.quantity);
  }
  return [...merged.entries()]
    .map(([itemDefinitionId, quantity]) => ({ itemDefinitionId, quantity }))
    .sort((a, b) => a.itemDefinitionId.localeCompare(b.itemDefinitionId));
}

function sameDeathPosition(a: DeathPosition | null, b: DeathPosition | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.x === b.x && a.y === b.y;
}

function isSameSubmission(
  existing: ExistingRaidResultRow,
  existingItems: ExistingRaidResultItemRow[],
  input: RaidResultInput,
): boolean {
  if (existing.result !== input.result) return false;
  if (existing.ended_at.getTime() !== new Date(input.endedAt).getTime()) return false;
  if ((existing.extraction_point_id ?? null) !== input.extractionPointId) return false;

  const existingDeathPosition: DeathPosition | null =
    existing.death_x !== null && existing.death_y !== null
      ? { x: Number(existing.death_x), y: Number(existing.death_y) }
      : null;
  if (!sameDeathPosition(existingDeathPosition, input.deathPosition)) return false;

  const normalizedExisting = normalizeItems(
    existingItems.map((row) => ({
      itemDefinitionId: row.item_definition_id,
      quantity: row.quantity,
    })),
  );
  const normalizedInput = normalizeItems(input.extractedItems);

  return JSON.stringify(normalizedExisting) === JSON.stringify(normalizedInput);
}

async function ensureItemDefinitionsExist(
  client: PoolClient,
  items: ExtractedItemInput[],
): Promise<Map<string, boolean>> {
  const distinctIds = [...new Set(items.map((item) => item.itemDefinitionId))];

  const result = await client.query<{ id: string; stackable: boolean }>(
    `select id, stackable
     from greyline_be.item_definitions
     where id = any($1::text[])`,
    [distinctIds],
  );

  const found = new Map(result.rows.map((row) => [row.id, row.stackable]));
  const missing = distinctIds.filter((id) => !found.has(id));

  if (missing.length > 0) {
    throw new AppError(
      422,
      "ITEM_DEFINITION_NOT_FOUND",
      `Unknown item definition id(s): ${missing.join(", ")}.`,
    );
  }

  return found;
}

async function mergeItemsIntoStash(
  client: PoolClient,
  accountId: string,
  items: ExtractedItemInput[],
  stackableById: Map<string, boolean>,
): Promise<void> {
  for (const item of items) {
    const stackable = stackableById.get(item.itemDefinitionId) ?? false;

    if (stackable) {
      const existingStashRow = await client.query<{ id: string; quantity: number }>(
        `select id, quantity
         from greyline_be.inventory_items
         where account_id = $1
           and item_definition_id = $2
           and location_type = 'stash'
         for update`,
        [accountId, item.itemDefinitionId],
      );

      if (existingStashRow.rowCount && existingStashRow.rowCount > 0) {
        const row = existingStashRow.rows[0];
        await client.query(
          `update greyline_be.inventory_items
           set quantity = $1, updated_at = now()
           where id = $2`,
          [row.quantity + item.quantity, row.id],
        );
        continue;
      }
    }

    await client.query(
      `insert into greyline_be.inventory_items
         (id, account_id, item_definition_id, quantity, location_type)
       values ($1, $2, $3, $4, 'stash')`,
      [randomUUID(), accountId, item.itemDefinitionId, item.quantity],
    );
  }
}

export async function acceptRaidResult(
  db: Pool,
  accountId: string,
  input: RaidResultInput,
): Promise<AcceptRaidResultOutcome> {
  validateDomainRules(input);

  const client = await db.connect();
  try {
    await client.query("begin");

    const existingResult = await client.query<ExistingRaidResultRow>(
      `select id, account_id, result, death_x, death_y, extraction_point_id, started_at, ended_at
       from greyline_be.raid_results
       where id = $1
       for update`,
      [input.raidId],
    );

    if (existingResult.rowCount && existingResult.rowCount > 0) {
      const existing = existingResult.rows[0];

      if (existing.account_id !== accountId) {
        throw new AppError(
          409,
          "RAID_RESULT_CONFLICT",
          "This raid result id was already submitted by a different account.",
        );
      }

      const existingItems = await client.query<ExistingRaidResultItemRow>(
        `select item_definition_id, quantity
         from greyline_be.raid_result_items
         where raid_result_id = $1`,
        [input.raidId],
      );

      if (!isSameSubmission(existing, existingItems.rows, input)) {
        throw new AppError(
          409,
          "RAID_RESULT_CONFLICT",
          "This raid result id was already submitted with different data.",
        );
      }

      await client.query("commit");

      return {
        accepted: true,
        raidId: input.raidId,
        result: existing.result,
        stashUpdated: existing.result === "success",
      };
    }

    let stashUpdated = false;
    let stackableById = new Map<string, boolean>();

    if (input.result === "success" && input.extractedItems.length > 0) {
      stackableById = await ensureItemDefinitionsExist(client, input.extractedItems);
    }

    await client.query(
      `insert into greyline_be.raid_results
         (id, account_id, result, death_x, death_y, extraction_point_id, started_at, ended_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [
        input.raidId,
        accountId,
        input.result,
        input.deathPosition?.x ?? null,
        input.deathPosition?.y ?? null,
        input.extractionPointId,
        input.startedAt,
        input.endedAt,
      ],
    );

    if (input.result === "success" && input.extractedItems.length > 0) {
      for (const item of input.extractedItems) {
        await client.query(
          `insert into greyline_be.raid_result_items
             (id, raid_result_id, item_definition_id, quantity, created_at)
           values ($1, $2, $3, $4, now())`,
          [randomUUID(), input.raidId, item.itemDefinitionId, item.quantity],
        );
      }

      await mergeItemsIntoStash(client, accountId, input.extractedItems, stackableById);
      stashUpdated = true;
    }

    await client.query("commit");

    return {
      accepted: true,
      raidId: input.raidId,
      result: input.result,
      stashUpdated,
    };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
