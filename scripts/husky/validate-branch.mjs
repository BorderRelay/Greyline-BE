import { execSync } from "node:child_process";

const branch = execSync("git branch --show-current", {
  encoding: "utf8",
}).trim();

if (!branch) {
  console.error("[STOP] current branch not found");
  process.exit(1);
}

if (["main", "master", "develop"].includes(branch)) {
  console.error(`[STOP] do not commit on default branch: ${branch}`);
  process.exit(1);
}

if (!/^(feat|refactor|hotfix)\/[a-z0-9]+(-[a-z0-9]+)*$/.test(branch)) {
  console.error(`[STOP] invalid branch format: ${branch}`);
  console.error("[RULE] type/scope-description");
  process.exit(1);
}
