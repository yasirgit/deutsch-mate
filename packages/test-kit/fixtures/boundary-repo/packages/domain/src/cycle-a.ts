// Deliberate violation: half of a dependency cycle.
import "./cycle-b.js";

export const a = "a";
