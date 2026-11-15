import { configForWorkspace } from "@deutsch-mate/config/eslint";

export default [
  {
    ignores: ["src/generated/**"],
  },
  ...configForWorkspace(import.meta.url),
];
