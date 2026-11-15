# @deutsch-mate/mobile

Strict-TypeScript placeholder for the React Native iOS/Android client
(ADR-005). Full React Native scaffolding — native projects, secure-token/OIDC
adapters, navigation, and build configuration — happens in **DM-058**;
`react-native init` was intentionally not run here.

Until then this workspace only exports app metadata (`src/index.ts`) and
participates in the repository lint/typecheck/build/test pipeline.
