/**
 * Deterministic clock for tests. Time must be controllable in tests
 * (`docs/CODING_STANDARDS.md` §7); production code injects a clock port
 * instead of reading the host clock directly.
 */
export interface TestClock {
  readonly now: () => Date;
  readonly advanceByMs: (durationMs: number) => void;
}

export function createTestClock(startAt: Date): TestClock {
  let currentMs = startAt.getTime();
  return {
    now: (): Date => new Date(currentMs),
    advanceByMs: (durationMs: number): void => {
      currentMs += durationMs;
    },
  };
}
