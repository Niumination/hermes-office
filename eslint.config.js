/**
 * Flat ESLint config.
 *
 * The project shipped with no linter, and the gap showed: the same
 * substring-vs-prefix matching bug was written twice (pricing.js, then
 * burnrate.js), and an unused import survived in the original source. These
 * rules are chosen to catch that class of mistake, not to enforce style.
 */
import globals from "globals";

export default [
  {
    files: ["server/**/*.js", "tests/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      // Correctness
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-fallthrough": "error",
      "no-unreachable": "error",
      "no-self-compare": "error",
      "no-unmodified-loop-condition": "error",
      "require-atomic-updates": "error",
      "no-await-in-loop": "off", // used deliberately for sequential ingest
      "no-return-await": "error",
      "no-throw-literal": "error",
      "no-promise-executor-return": "error",

      // The bugs this project actually hit
      "no-implicit-coercion": ["error", { boolean: false }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-shadow": "error",

      // Regex hygiene — policy patterns run in the request path
      "no-control-regex": "error",
      "no-misleading-character-class": "error",
      "prefer-regex-literals": "error",
    },
  },
  {
    files: ["tests/**/*.js"],
    rules: { "no-shadow": "off" },
  },
];
