const emojiPrefix = String.raw`(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?\s+)?`;
const headerPattern = new RegExp(
  `^${emojiPrefix}(feat|refactor|hotfix)(?:\\(([a-z0-9-]+)\\))?:\\s+(.+)$`,
  "u",
);

const koreanNounStylePlugin = {
  rules: {
    "subject-no-handa": (parsed) => {
      const subject = parsed.subject?.trim() ?? "";

      if (!subject) {
        return [false, "subject is required"];
      }

      if (/(한다|했다|합니다|하였다|하도록)$/.test(subject)) {
        return [false, "subject must use concise noun style, not '~한다' phrasing"];
      }

      return [true];
    },
  },
};

export default {
  extends: ["@commitlint/config-conventional"],
  parserPreset: {
    parserOpts: {
      headerPattern,
      headerCorrespondence: ["type", "scope", "subject"],
    },
  },
  plugins: [koreanNounStylePlugin],
  rules: {
    "type-enum": [2, "always", ["feat", "refactor", "hotfix"]],
    "scope-case": [2, "always", "kebab-case"],
    "scope-empty": [0],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 100],
    "subject-no-handa": [2, "always"],
  },
};
