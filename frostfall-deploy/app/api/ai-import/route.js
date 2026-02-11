import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { text, filename } = await request.json();

    if (!text || text.length < 20) {
      return NextResponse.json({ error: "Document text too short" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Anthropic API key not configured" }, { status: 500 });
    }

    const systemPrompt = `You are a worldbuilding document parser for a fantasy codex system. Analyze the provided document and extract structured entries.

For each entity found, output a JSON object with:
- title: Entity name
- category: One of: deity, race, character, event, location, organization, item, magic, language, flora_fauna, laws_customs
- summary: 1-2 sentence description
- fields: Object with category-specific template fields:
  * deity: domain, symbol, court, sacred_time, worshippers, gift_to_mortals
  * race: creators, lifespan, population, magic_affinity, homeland, capital
  * character: char_race, birth_year, death_year, titles, affiliations, role
  * event: date_range, age, casualties, key_figures, outcome
  * location: region, ruler, population, founding_year, notable_features, status
  * organization: type, founded, leader, headquarters, purpose, members
  * item: type, creator, current_location, power, history
  * magic: type, origin, scope, cost_types, violation_consequence
  * language: speakers, script, lang_origin, sample_phrases, grammar_notes, lang_status
  * flora_fauna: species_type, habitat, rarity, uses, danger_level, description
  * laws_customs: custom_type, enforced_by, applies_to, penalties, cultural_significance, exceptions
- body: Detailed lore text with @mentions to other entities (use snake_case IDs like @entity_name)
- tags: Array of relevant tags
- temporal: { type: "immortal"|"mortal"|"event"|"concept"|"race", active_start: year_number, active_end: year_number_or_null, birth_year: number_or_null, death_year: number_or_null }

Respond ONLY with a JSON array of entries. No markdown, no explanation.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Parse this document and extract all worldbuilding entities as structured codex entries:\n\nFilename: ${filename}\n\n${text.slice(0, 30000)}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", err);
      return NextResponse.json({ error: "AI API request failed: " + response.status }, { status: 502 });
    }

    const data = await response.json();
    const raw = data.content?.map((c) => c.text || "").join("") || "";
    const cleaned = raw.replace(/`{3}json|`{3}/g, "").trim();

    let entries;
    try {
      entries = JSON.parse(cleaned);
    } catch (e) {
      console.error("Failed to parse AI response:", cleaned.slice(0, 500));
      return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 502 });
    }

    return NextResponse.json({ entries });
  } catch (err) {
    console.error("AI import error:", err);
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}
