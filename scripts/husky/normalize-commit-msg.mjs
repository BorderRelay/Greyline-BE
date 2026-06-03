import fs from "node:fs";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Missing commit message file path.");
  process.exit(1);
}

const emojiMap = new Map([
  ["feat", "✨"],
  ["refactor", "♻️"],
  ["hotfix", "🚑"],
  ["fix", "🐛"],
  ["docs", "📝"],
  ["chore", "🧹"],
  ["test", "✅"],
]);

const raw = fs.readFileSync(filePath, "utf8");
const lines = raw.split(/\r?\n/);
const subject = lines[0]?.trim() ?? "";

if (!subject) {
  process.exit(0);
}

if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(subject)) {
  process.exit(0);
}

const match = subject.match(/^([a-z]+)(\([^)]+\))?:\s+(.+)$/u);

if (!match) {
  process.exit(0);
}

const [, type, scope = "", summary] = match;
const emoji = emojiMap.get(type);

if (!emoji) {
  process.exit(0);
}

lines[0] = `${emoji} ${type}${scope}: ${summary}`;
fs.writeFileSync(filePath, `${lines.join("\n").replace(/\n*$/, "")}\n`, "utf8");
