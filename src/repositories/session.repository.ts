import type { Pool } from "pg";

export type SessionRow = {
  id: string;
  account_id: string;
  refresh_token_hash: string;
  expires_at: Date;
  last_used_at: Date;
};

export type CreateSessionParams = {
  id: string;
  accountId: string;
  refreshTokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
};

export async function createSession(db: Pool, params: CreateSessionParams): Promise<SessionRow> {
  const result = await db.query<SessionRow>(
    `insert into greyline_be.account_sessions
       (id, account_id, refresh_token_hash, user_agent, ip_address, expires_at)
     values ($1, $2, $3, $4, $5::inet, $6)
     returning id, account_id, refresh_token_hash, expires_at, last_used_at`,
    [
      params.id,
      params.accountId,
      params.refreshTokenHash,
      params.userAgent,
      params.ipAddress,
      params.expiresAt,
    ],
  );
  return result.rows[0];
}

export async function findSessionByTokenHash(db: Pool, hash: string): Promise<SessionRow | null> {
  const result = await db.query<SessionRow>(
    `select id, account_id, refresh_token_hash, expires_at, last_used_at
     from greyline_be.account_sessions
     where refresh_token_hash = $1`,
    [hash],
  );
  return result.rows[0] ?? null;
}

export async function rotateSession(
  db: Pool,
  id: string,
  newHash: string,
  newExpiresAt: Date,
): Promise<void> {
  await db.query(
    `update greyline_be.account_sessions
     set refresh_token_hash = $2, expires_at = $3, last_used_at = now()
     where id = $1`,
    [id, newHash, newExpiresAt],
  );
}

export async function deleteSession(db: Pool, tokenHash: string, accountId: string): Promise<void> {
  await db.query(
    `delete from greyline_be.account_sessions
     where refresh_token_hash = $1 and account_id = $2`,
    [tokenHash, accountId],
  );
}

export async function deleteAllSessions(db: Pool, accountId: string): Promise<void> {
  await db.query(`delete from greyline_be.account_sessions where account_id = $1`, [accountId]);
}

/**
 * Lazily sweeps expired `account_sessions` rows. Called on login so stale
 * sessions never accumulate indefinitely — see backend-auth-spec.md §13
 * "Session cleanup job" (lazy deletion on login is one of the two accepted
 * approaches). Uses `idx_account_sessions_expires_at` for the scan.
 */
export async function deleteExpiredSessions(db: Pool): Promise<number> {
  const result = await db.query(
    `delete from greyline_be.account_sessions where expires_at <= now()`,
  );
  return result.rowCount ?? 0;
}
