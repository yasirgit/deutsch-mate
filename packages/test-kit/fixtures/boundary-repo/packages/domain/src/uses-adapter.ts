// Deliberate violation: pure domain code importing a database adapter.
import "pg";

export const usesAdapter = true;
