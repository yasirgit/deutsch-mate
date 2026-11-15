// Deliberate violation: other half of a dependency cycle.
import "./cycle-a.js";

export const b = "b";
