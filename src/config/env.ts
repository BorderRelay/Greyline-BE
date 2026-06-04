import dotenv from "dotenv";

dotenv.config();

function readString(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readPort(name: string, fallback: number) {
  const raw = process.env[name] ?? String(fallback);
  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid port in environment variable ${name}: ${raw}`);
  }

  return parsed;
}

export const env = {
  NODE_ENV: readString("NODE_ENV", "development"),
  HOST: readString("HOST", "0.0.0.0"),
  PORT: readPort("PORT", 3000),
  DATABASE_URL: readString(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/greyline",
  ),
  DATABASE_SCHEMA: readString("DATABASE_SCHEMA", "greyline_be"),
} as const;
