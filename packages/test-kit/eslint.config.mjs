import { configForWorkspace } from "@deutsch-mate/config/eslint";

export default [
  // Boundary-violation fixtures deliberately contain forbidden imports; they
  // are linted by the regression tests, not by the workspace lint task.
  { ignores: ["fixtures/**"] },
  ...configForWorkspace(import.meta.url),
];
