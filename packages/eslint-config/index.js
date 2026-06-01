/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ["eslint:recommended"],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "no-console": "warn",
  },
};
