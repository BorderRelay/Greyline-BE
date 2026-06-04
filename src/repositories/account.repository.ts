import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

export type AccountRow = {
  id: string;
  email: string | null;
  password_hash: string | null;
  status: string;
};

export async function findAccountByEmail(db: Pool, email: string): Promise<AccountRow | null> {
  const result = await db.query<AccountRow>(
    `select id, email, password_hash, status
     from greyline_be.accounts
     where email = $1`,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findAccountById(db: Pool, id: string): Promise<AccountRow | null> {
  const result = await db.query<AccountRow>(
    `select id, email, password_hash, status
     from greyline_be.accounts
     where id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function updateLastLogin(db: Pool, id: string): Promise<void> {
  await db.query(`update greyline_be.accounts set last_login_at = now() where id = $1`, [id]);
}

const DEFAULT_LOADOUT_SLOTS = [
  "primary_weapon",
  "secondary_weapon",
  "consumable_1",
  "consumable_2",
] as const;

export type CreateAccountParams = {
  email: string;
  passwordHash: string;
};

export async function createAccount(db: Pool, params: CreateAccountParams): Promise<AccountRow> {
  const client = await db.connect();

  try {
    await client.query("begin");

    const accountId = randomUUID();

    const result = await client.query<AccountRow>(
      `insert into greyline_be.accounts (id, email, password_hash)
       values ($1, $2, $3)
       returning id, email, password_hash, status`,
      [accountId, params.email, params.passwordHash],
    );

    await client.query(
      `insert into greyline_be.account_profiles (account_id, money)
       values ($1, 0)`,
      [accountId],
    );

    for (const slotName of DEFAULT_LOADOUT_SLOTS) {
      await client.query(
        `insert into greyline_be.loadout_slots (account_id, slot_name)
         values ($1, $2)`,
        [accountId, slotName],
      );
    }

    await client.query("commit");

    return result.rows[0];
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
