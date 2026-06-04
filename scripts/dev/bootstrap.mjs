import { execFileSync } from "node:child_process";
import { URL } from "node:url";

import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config();

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/greyline";
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function isLocalDatabaseUrl(value) {
  try {
    return localHosts.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

async function canConnect() {
  const client = new Client({
    connectionString: databaseUrl,
  });

  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

function startManagedPostgres() {
  execFileSync(process.execPath, ["scripts/dev/postgres.mjs", "up"], {
    encoding: "utf8",
    stdio: "inherit",
  });
}

function runMigrations() {
  execFileSync(process.execPath, ["scripts/dev/migrate.mjs"], {
    encoding: "utf8",
    stdio: "inherit",
  });
}

async function main() {
  if (await canConnect()) {
    runMigrations();
    return;
  }

  if (!isLocalDatabaseUrl(databaseUrl)) {
    throw new Error(
      "DATABASE_URL is not reachable and does not point to a local host, so the local Docker fallback is disabled.",
    );
  }

  startManagedPostgres();

  if (await canConnect()) {
    runMigrations();
    return;
  }

  throw new Error("PostgreSQL bootstrap failed even after starting the managed container.");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
