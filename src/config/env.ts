import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  NODE_ENV: string;
  HOST: string;
  PORT: number;
  DATABASE_URL: string;
  DATABASE_SCHEMA: string;
  LOG_LEVEL: string;
  CORS_ORIGIN: string;
  SWAGGER_ENABLED: boolean;
  SWAGGER_ROUTE_PREFIX: string;
  APP_NAME: string;
  APP_VERSION: string;
  JWT_SECRET: string;
  JWT_ACCESS_EXPIRES_IN: number;
  REFRESH_TOKEN_EXPIRES_DAYS: number;
};

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

function readPositiveInt(name: string, fallback: number) {
  const raw = process.env[name] ?? String(fallback);
  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer in environment variable ${name}: ${raw}`);
  }

  return parsed;
}

function readBoolean(name: string, fallback: boolean) {
  const raw = process.env[name];

  if (raw === undefined) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) {
    return false;
  }

  throw new Error(`Invalid boolean in environment variable ${name}: ${raw}`);
}

export function loadEnv(): AppConfig {
  const nodeEnv = readString("NODE_ENV", "development");

  return {
    NODE_ENV: nodeEnv,
    HOST: readString("HOST", "0.0.0.0"),
    PORT: readPort("PORT", 3000),
    DATABASE_URL: readString(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/greyline",
    ),
    DATABASE_SCHEMA: readString("DATABASE_SCHEMA", "greyline_be"),
    LOG_LEVEL: readString("LOG_LEVEL", nodeEnv === "development" ? "debug" : "info"),
    CORS_ORIGIN: readString("CORS_ORIGIN", "*"),
    SWAGGER_ENABLED: readBoolean("SWAGGER_ENABLED", nodeEnv === "development"),
    SWAGGER_ROUTE_PREFIX: readString("SWAGGER_ROUTE_PREFIX", "/documentation"),
    APP_NAME: readString("APP_NAME", "greyline-be"),
    APP_VERSION: readString("APP_VERSION", "0.1.0"),
    JWT_SECRET: readString("JWT_SECRET"),
    JWT_ACCESS_EXPIRES_IN: readPositiveInt("JWT_ACCESS_EXPIRES_IN", 900),
    REFRESH_TOKEN_EXPIRES_DAYS: readPositiveInt("REFRESH_TOKEN_EXPIRES_DAYS", 30),
  };
}

export const env = loadEnv();
