/**
 * React Native placeholder workspace. Full React Native scaffolding, secure
 * OIDC/token adapters, and native build configuration land with DM-058; this
 * workspace only reserves the app metadata and toolchain participation.
 */
export const APP_METADATA = {
  name: "Deutsch Mate",
  workspace: "@deutsch-mate/mobile",
  platforms: ["ios", "android"],
  scaffoldingTask: "DM-058",
} as const;

export type AppMetadata = typeof APP_METADATA;
