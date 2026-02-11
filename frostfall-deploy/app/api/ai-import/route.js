import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are a worldbuilding document parser. Extract structured entries from fantasy lore documents.

For each entity, output a JSON object with these fields:
- title: Entity name
- category: One of: deity, race, character, event, location, organization, item, magic, language, flora_fauna, laws_customs
- summary: 1-2 sentence description
- fields: Object with category-specific fields
- body: Detailed lore text using @snake_case_ids for cross-references
- tags: Array of relevant tags
- temporal: { type: "immortal"|"mortal"|"event"|"concept"|"race", active_start: number|null, active_end: number|null, birth_year: number|null, death_year: number|null }

Category template fields:
- deity: domain, symbol, court, sacred_time, worshippers, gift_to_mortals
- race: creators, lifespan, population, magic_affinity, homeland, capital
- character: char_race, birth_year, death_year, titles, affiliations, role
- event: date_range, age, casualties, key_figures, outcome
- location: region, ruler, population, founding_year, notable_features, status
- organization: type, founded, leader, headquarters, purpose, members
- item: type, creator, current_location, power, history
- magic: type, origin, scope, cost_types, violation_consequence
- language: speakers, script, lang_origin, sample_phrases, grammar_notes, lang_status
- flora_fauna: species_type, habitat, rarity, uses, danger_level, description
- laws_customs: custom_type, enforced_by, applies_to, penalties, cultural_significance, exceptions

CRITICAL RULES:
1. Your ENTIRE response must be ONLY a valid JSON array
2. Start with [ and end with ]
3. No markdown, no code fences, no explanation text
4. No trailing commas in objects or arrays
5. All strings must use double quotes`;

function extractJSON(raw, wasTruncated) {
  let jsonText = raw;
  if (wasTruncated) {
    const lastComplete = jsonText.lastIndexOf("}");
    if (lastComplete !== -1) {
      jsonText = jsonText.slice(0, lastComplete + 1) + "]";
    }
  }

  // Attempt 1: Direct parse
  try { return JSON.parse(jsonText.trim()); } catch (_) {}

  // Attempt 2: Strip code fences
  try {
    const stripped = jsonText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    return JSON.parse(stripped);
  } catch (_) {}

  // Attempt 3: Bracket matching
  const start = jsonText.indexOf("[");
  if (start !== -1) {
    let depth = 0, end = -1;
    for (let i = start; i < jsonText.length; i++) {
      if (jsonText[i] === "[") depth++;
      if (jsonText[i] === "]") depth--;
      if (depth === 0) { end = i; break; }
    }
    if (end !== -1) {
      const slice = jsonText.slice(start, end + 1);
      try { return JSON.parse(slice); } catch (_) {
        try { return JSON.parse(slice.replace(/,\s*([\]}])/g, "$1")); } catch (_) {}
    }
  }
}

// Attempt 4: Single object
const objStart = jsonText.indexOf("{");
if (objStart !== -1) {
  try {
    return [JSON.parse(jsonText.slice(objStart).replace(/```\s*$/g, "").trim())];
  } catch (_) {}
}

return null;
}

function cleanEntries(entries) {
  if (!Array.isArray(entries)) entries = [entries];
  return entries
  .filter((e) => e && typeof e === "object" && e.title && e.category)
  .map((e) => ({
    title: String(e.title || ""),
               category: String(e.category || ""),
               summary: String(e.summary || ""),
               fields: (typeof e.fields === "object" && e.fields) ? e.fields : {},
               body: String(e.body || ""),
               tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
               temporal: (typeof e.temporal === "object" && e.temporal) ? e.temporal : null,
  }));
}

export async function POST(request) {
  try {
    const { text, filename, chunkIndex, totalChunks } = await request.json();

    if (!text || text.length < 10) {
      return NextResponse.json({ error: "Text too short", entries: [] }, { status: 200 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Anthropic API key not configured" }, { status: 500 });
    }

    const chunkContext = totalChunks > 1
    ? `\n\nThis is chunk ${chunkIndex + 1} of ${totalChunks} from the document "${filename}". Extract only entities found in THIS chunk.`
    : "";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: "Parse this document section into codex entries. Return ONLY a JSON array." + chunkContext + "\n\n" + text,
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", response.status, err);
      return NextResponse.json({ error: "AI API error " + response.status, entries: [] }, { status: 502 });
    }

    const data = await response.json();
    const raw = data.content?.map((c) => c.text || "").join("") || "";
    const wasTruncated = data.stop_reason === "max_tokens";

    if (!raw || raw.trim().length === 0) {
      return NextResponse.json({ entries: [], warning: "AI returned empty response for this chunk" });
    }

    const parsed = extractJSON(raw, wasTruncated);
    if (!parsed) {
      console.error("Parse failed for chunk", chunkIndex, "Raw:", raw.slice(0, 1000));
      return NextResponse.json({ entries: [], warning: "Could not parse AI response for this chunk" });
    }

    const entries = cleanEntries(parsed);
    return NextResponse.json({ entries, wasTruncated });
  } catch (err) {
    console.error("AI import error:", err);
    return NextResponse.json({ error: err.message || "Unknown error", entries: [] }, { status: 500 });
  }
}
