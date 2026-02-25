import { describe, it, expect } from "vitest";
import { checkSceneIntegrity, isHardSceneIssue } from "../lib/domain/novelIntegrity.js";

const CODEX = [
  { id: "vaerith", title: "Vaerith", temporal: { type: "mortal", death_year: 110, active_start: 80, active_end: 110 } },
];

describe("Truth Engine: Scene Integrity", () => {
  it("flags missing codex mentions as hard scene issues (rich mention)", () => {
    const body = 'The tale mentions @[Ghost](ghost_123).';
    const warnings = checkSceneIntegrity(body, CODEX);
    const hard = warnings.filter(isHardSceneIssue);

    expect(hard.some((w) => w.type === "broken_ref")).toBe(true);
  });

  it("does not hard-gate raw mentions by default", () => {
    const body = "A raw mention @vaerith appears here.";
    const warnings = checkSceneIntegrity(body, CODEX);
    const hard = warnings.filter(isHardSceneIssue);

    // raw_mention should remain soft unless you explicitly decide otherwise
    expect(hard.length).toBe(0);
  });
});