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
