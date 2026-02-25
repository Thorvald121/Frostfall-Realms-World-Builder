import { describe, it, expect } from "vitest";
import { buildTemporalGraph } from "../lib/domain/truth/temporalGraph.js";

describe("Temporal Graph Engine", () => {
  it("extracts mentions and can flag impossible references", () => {
    const articles = [
      {
        id: "event_130",
        title: "Battle of Frost",
        category: "events",
        body: "In this battle, @[Vaerith](vaerith) is remembered.",
        temporal: { type: "event", active_start: 130, active_end: 130 },
      },
      {
        id: "vaerith",
        title: "Vaerith",
        category: "characters",
        body: "A figure.",
        temporal: { type: "mortal", active_start: 80, active_end: 110, death_year: 110 },
      },
    ];

    const g = buildTemporalGraph(articles);
    const ref = g.isImpossibleReference("event_130", "vaerith");

    // Vaerith died 20 years before Year 130
    expect(ref).not.toBeNull();
    expect(ref.type).toBe("temporal_impossible");
  });
});