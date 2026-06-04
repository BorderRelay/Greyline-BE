import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config();

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/greyline";
const databaseSchema = process.env.DATABASE_SCHEMA ?? "greyline_be";
const migrationsDir = resolve("migrations");

function assertIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return value;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function main() {
  const schema = assertIdentifier(databaseSchema, "DATABASE_SCHEMA");
  const schemaRef = quoteIdentifier(schema);
  const client = new Client({
    connectionString: databaseUrl,
  });

  await client.connect();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaRef}`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}.schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedRows = await client.query(
      `SELECT filename FROM ${schemaRef}.schema_migrations ORDER BY filename`,
    );
    const applied = new Set(appliedRows.rows.map((row) => row.filename));

    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    for (const filename of migrationFiles) {
      if (applied.has(filename)) {
        continue;
      }

      const migrationSql = readFileSync(resolve(migrationsDir, filename), "utf8");

      await client.query("BEGIN");

      try {
        await client.query(`SET LOCAL search_path TO ${schemaRef}`);
        await client.query(migrationSql);
        await client.query(`INSERT INTO ${schemaRef}.schema_migrations (filename) VALUES ($1)`, [
          filename,
        ]);
        await client.query("COMMIT");
        console.log(`Applied migration ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
