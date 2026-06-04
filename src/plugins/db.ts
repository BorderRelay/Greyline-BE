import fp from "fastify-plugin";
import { Pool } from "pg";

import type { AppConfig } from "../config/env.js";

export const dbPlugin = fp<{ config: AppConfig }>(async (app, options) => {
  const pool = new Pool({
    connectionString: options.config.DATABASE_URL,
    max: 10,
  });

  await pool.query("select 1");

  const schemaCheck = await pool.query(
    "select schema_name from information_schema.schemata where schema_name = $1",
    [options.config.DATABASE_SCHEMA],
  );

  if (schemaCheck.rowCount !== 1) {
    await pool.end();
    throw new Error(`Database schema not found: ${options.config.DATABASE_SCHEMA}`);
  }

  app.decorate("db", pool);

  app.addHook("onClose", async () => {
    await pool.end();
  });
});
