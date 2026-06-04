import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const preferredContainerName = "postgres-sql";
const legacyContainerName = "greyline-postgres";
const image = "postgres:17";
const dbName = "greyline";
const dbUser = "postgres";
const dbPassword = "postgres";
const hostPort = "5432";

const command = process.argv[2] ?? "up";

function runDocker(args, options = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  }).trim();
}

function hasContainer(name = preferredContainerName) {
  const output = runDocker(["ps", "-a", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"]);
  return output === name;
}

function isRunning(name = preferredContainerName) {
  const output = runDocker(["ps", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"]);
  return output === name;
}

function renameLegacyContainer() {
  if (hasContainer(preferredContainerName) || !hasContainer(legacyContainerName)) {
    return;
  }

  runDocker(["rename", legacyContainerName, preferredContainerName]);
}

function ensureContainer() {
  renameLegacyContainer();

  if (!hasContainer()) {
    runDocker([
      "run",
      "-d",
      "--name",
      preferredContainerName,
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
    runDocker(["start", preferredContainerName]);
  }
}

function waitUntilReady() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      runDocker(["exec", preferredContainerName, "pg_isready", "-U", dbUser, "-d", dbName]);
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }

  throw new Error("PostgreSQL did not become ready in time.");
}

if (command === "up") {
  ensureContainer();
  waitUntilReady();
  console.log(`PostgreSQL container ${preferredContainerName} is ready.`);
  process.exit(0);
}

if (command === "down") {
  if (hasContainer()) {
    runDocker(["stop", preferredContainerName]);
  } else if (hasContainer(legacyContainerName)) {
    runDocker(["stop", legacyContainerName]);
  }
  console.log(`PostgreSQL container ${preferredContainerName} stopped.`);
  process.exit(0);
}

if (command === "status") {
  console.log(isRunning() || isRunning(legacyContainerName) ? "running" : "stopped");
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);
