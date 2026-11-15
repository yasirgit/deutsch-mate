/**
 * Client fixtures for DM-037: interface locale stays on identity `PATCH /me`;
 * learner preferences live on `PUT /me/profile` (never mixed).
 */

export type InterfaceLocalePatchFixture = {
  readonly interfaceLocale: string;
};

export type LearnerProfileInputFixture = {
  readonly goal:
    | "relocation"
    | "work"
    | "study"
    | "travel"
    | "daily_life"
    | "general";
  readonly selectedLevel: "A1" | "A2" | "B1" | "B2";
  readonly targetLevel?: "A1" | "A2" | "B1" | "B2" | null;
  readonly studyMinutesPerDay?: number | null;
  readonly studyDaysPerWeek?: number | null;
  readonly preferences: Record<string, unknown>;
};

/** Minimal onboarding path: locale via /me, self-selected A1, optional cadence skipped. */
export const firstSessionClientFixture = {
  localePatch: { interfaceLocale: "de" } satisfies InterfaceLocalePatchFixture,
  profileInput: {
    goal: "general",
    selectedLevel: "A1",
    targetLevel: null,
    studyMinutesPerDay: null,
    studyDaysPerWeek: null,
    preferences: { skippedSteps: ["cadence"] },
  } satisfies LearnerProfileInputFixture,
  onboardingSteps: [
    { stepCode: "goal", completedSteps: ["legal"] },
    { stepCode: "level", completedSteps: ["legal", "goal"] },
    {
      stepCode: "ready",
      completedSteps: ["legal", "goal", "level", "cadence"],
    },
  ],
} as const;

/** Assert fixture shapes never put interfaceLocale on the learner profile body. */
export function assertLocaleProfileSeparation(
  localePatch: InterfaceLocalePatchFixture,
  profileInput: LearnerProfileInputFixture,
): void {
  if (!("interfaceLocale" in localePatch)) {
    throw new Error("locale patch must carry interfaceLocale");
  }
  if ("interfaceLocale" in profileInput) {
    throw new Error("learner profile must not own interfaceLocale");
  }
}
