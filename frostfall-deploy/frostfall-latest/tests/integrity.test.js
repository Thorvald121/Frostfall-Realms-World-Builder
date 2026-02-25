import { describe, it, expect } from "vitest";
import { checkArticleIntegrity, isHardIntegrityIssue } from "../lib/domain/integrity.js";

const CODEX = [
  {
    id: "vaerith",
    title: "Vaerith",
    category: "characters",
    body: "A figure in the grove.",
    fields: {},
    temporal: { type: "mortal", active_start: 80, active_end: 110, death_year: 110 },
  },
];

describe("Truth Engine: Article Integrity", () => {
  it("treats broken refs as hard issues (rich mention)", () => {
    const entry = {
      id: "test_entry",
      title: "Test Entry",
      category: "events",
      body: "Mentions @[Ghost](ghost_123).",
      fields: {},
      temporal: { type: "event", active_start: 130, active_end: 130 },
    };

    const warnings = checkArticleIntegrity(entry, CODEX, null);
    const hard = warnings.filter(isHardIntegrityIssue);

    expect(hard.some((w) => w.type === "broken_ref")).toBe(true);
  });

  it("treats broken refs as hard issues (raw mention)", () => {
    const entry = {
      id: "test_entry_2",
      title: "Test Entry 2",
      category: "events",
      body: "Mentions @Ghost.",
      fields: {},
      temporal: { type: "event", active_start: 130, active_end: 130 },
    };

    const warnings = checkArticleIntegrity(entry, CODEX, null);
    const hard = warnings.filter(isHardIntegrityIssue);

    expect(hard.some((w) => w.type === "broken_ref")).toBe(true);
  });

  it("does not hard-gate purely informational issues", () => {
    const entry = {
      id: "lonely_entry",
      title: "Lonely Entry",
      category: "events",
      body: "",
      fields: {},
      temporal: { type: "event", active_start: 10, active_end: 10 },
    };

    const warnings = checkArticleIntegrity(entry, CODEX, null);
    const hard = warnings.filter(isHardIntegrityIssue);

    expect(Array.isArray(warnings)).toBe(true);
    expect(hard.length).toBe(0);
  });
});