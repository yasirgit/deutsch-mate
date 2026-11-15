import baseConfig from "@deutsch-mate/config/eslint";

export default [
  {
    ignores: [
      "apps/**",
      "packages/**",
      "docs/**",
      "infra/**",
      "migrations/**",
      "scripts/**",
      ".pnpm-store/**",
    ],
  },
  ...baseConfig,
];
