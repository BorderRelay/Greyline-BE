import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const containerName = "greyline-postgres";
const image = "postgres:17";
const dbName = "greyline";
const dbUser = "postgres";
const dbPassword = "postgres";
const hostPort = "5432";
const initSqlPath = resolve("scripts/db/init-postgres.sql");

const command = process.argv[2] ?? "up";

function runDocker(args, options = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  }).trim();
}

function hasContainer() {
  const output = runDocker([
    "ps",
    "-a",
    "--filter",
    `name=^/${containerName}$`,
    "--format",
    "{{.Names}}",
  ]);
  return output === containerName;
}

function isRunning() {
  const output = runDocker([
    "ps",
    "--filter",
    `name=^/${containerName}$`,
    "--format",
    "{{.Names}}",
  ]);
  return output === containerName;
}

function ensureContainer() {
  if (!hasContainer()) {
    runDocker([
      "run",
      "-d",
      "--name",
      containerName,
      "-e",
      `POSTGRES_DB=${dbName}`,
      "-e",
      `POSTGRES_USER=${dbUser}`,
      "-e",
      `POSTGRES_PASSWORD=${dbPassword}`,
      "-p",
      `${hostPort}:5432`,
      "-v",
      "greyline-postgres-data:/var/lib/postgresql/data",
      image,
    ]);
    return;
  }

  if (!isRunning()) {
    runDocker(["start", containerName]);
  }
}

function waitUntilReady() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      runDocker(["exec", containerName, "pg_isready", "-U", dbUser, "-d", dbName]);
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }

  throw new Error("PostgreSQL did not become ready in time.");
}

function initSchema() {
  const sql = readFileSync(initSqlPath);
  execFileSync("docker", ["exec", "-i", containerName, "psql", "-U", dbUser, "-d", dbName], {
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
  });
}

if (command === "up") {
  ensureContainer();
  waitUntilReady();
  initSchema();
  console.log(`PostgreSQL container ${containerName} is ready.`);
  process.exit(0);
}

if (command === "down") {
  if (hasContainer()) {
    runDocker(["stop", containerName]);
  }
  console.log(`PostgreSQL container ${containerName} stopped.`);
  process.exit(0);
}

if (command === "status") {
  console.log(isRunning() ? "running" : "stopped");
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);
