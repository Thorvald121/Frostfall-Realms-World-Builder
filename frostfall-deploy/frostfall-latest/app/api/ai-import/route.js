import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are a worldbuilding document parser for a fantasy codex. Extract structured entries from lore documents.

CRITICAL MERGING RULES:
- Physical characteristics (height, build, aging, male/female traits) should be MERGED into the parent Race entry as fields, NOT created as separate entries
- Sub-sections about a race's nature, cost, burden, duality etc. should be part of that race's body text, NOT separate entries
- Gender-specific descriptions (Male Alduinari, Female Kaelthari) are sub-data of the race, NOT separate entries
- If you see sections like "Male [Race]" and "Female [Race]", combine them into the race entry's body and add physical_characteristics to fields
- Comparative charts, size charts, and aging tables should be merged into the most relevant parent entry
- Do NOT create entries for section headers, table of contents, or structural markers

DEDUPLICATION RULES:
- If the same entity appears multiple times in the text, create only ONE entry with merged information
- Skip duplicate sections (content that repeats verbatim or near-verbatim)

For each DISTINCT entity, output a JSON object with:
- title: Entity name (clean, no markdown artifacts like {#...} or .unnumbered)
- category: One of: deity, race, character, event, location, organization, item, magic, language, flora_fauna, laws_customs
- summary: 1-2 sentence description
- fields: Object with category-specific fields (see below)
- body: Detailed lore text using @snake_case_ids for cross-references to other entities
- tags: Array of relevant tags
- temporal: { type: "immortal"|"mortal"|"event"|"concept"|"race", active_start: number|null, active_end: number|null, birth_year: number|null, death_year: number|null }

Category template fields:
- deity: domain, symbol, court, sacred_time, worshippers, gift_to_mortals
- race: creators, lifespan, population, magic_affinity, homeland, capital, physical_characteristics
- character: char_race, birth_year, death_year, titles, affiliations, role
- event: date_range, age, casualties, key_figures, outcome
- location: region, ruler, population, founding_year, notable_features, status
- organization: type, founded, leader, headquarters, purpose, members
- item: type, creator, current_location, power, history
- magic: type, origin, scope, cost_types, violation_consequence
- language: speakers, script, lang_origin, sample_phrases, grammar_notes, lang_status
- flora_fauna: species_type, habitat, rarity, uses, danger_level, description
- laws_customs: custom_type, enforced_by, applies_to, penalties, cultural_significance, exceptions

For race entries, physical_characteristics should be a string containing male/female traits, height ranges, build, distinguishing features, aging patterns, etc.

CRITICAL OUTPUT RULES:
1. Your ENTIRE response must be ONLY a valid JSON array: [ ... ]
2. No markdown, no code fences, no explanation text
3. No trailing commas
4. All strings must use double quotes
5. Clean all title text of markdown artifacts like {#id .unnumbered}`;

// Strip invalid Unicode surrogate code units (common in pasted/converted docs)
function sanitizeForJSON(s) {
  return (s || "").replace(/[\uD800-\uDFFF]/g, "");
}

// Try hard to parse a JSON array from a model response
function extractJSON(raw, wasTruncated) {
  let jsonText = String(raw || "");

  // Remove common fence wrappers if the model disobeys
  jsonText = jsonText
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // If truncated, try to close the last object and the array
  if (wasTruncated) {
    const lastObjClose = jsonText.lastIndexOf("}");
    if (lastObjClose !== -1) {
      // Make a best-effort to end with a JSON array
      jsonText = jsonText.slice(0, lastObjClose + 1);
      if (!jsonText.trim().endsWith("]")) jsonText += "]";
      if (!jsonText.trim().startsWith("[")) jsonText = "[" + jsonText;
    }
  }

  // 1) Direct parse
  try {
    const parsed = JSON.parse(jsonText);
    return parsed;
  } catch (_) {
    // continue
  }

  // 2) Extract the first complete [...] block
  const start = jsonText.indexOf("[");
  if (start !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = start; i < jsonText.length; i++) {
      if (jsonText[i] === "[") depth++;
      else if (jsonText[i] === "]") depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    if (end !== -1) {
      const slice = jsonText.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch (_) {
        // try removing trailing commas
        try {
          return JSON.parse(slice.replace(/,\s*([\]}])/g, "$1"));
        } catch (_) {
          // continue
        }
      }
    }
  }

  // 3) If it returned a single object, wrap it into an array
  const objStart = jsonText.indexOf("{");
  if (objStart !== -1) {
    const objText = jsonText.slice(objStart).trim();
    try {
      return [JSON.parse(objText)];
    } catch (_) {
      try {
        return [JSON.parse(objText.replace(/,\s*([\]}])/g, "$1"))];
      } catch (_) {
        // continue
      }
    }
  }

  return null;
}

function cleanEntries(entries) {
  const arr = Array.isArray(entries) ? entries : entries ? [entries] : [];
  return arr
    .filter((e) => e && typeof e === "object" && e.title && e.category)
    .map((e) => ({
      title: String(e.title || "")
        .replace(/\{#[^}]*\}/g, "")
        .replace(/\.unnumbered/g, "")
        .trim(),
      category: String(e.category || "").trim(),
      summary: String(e.summary || "").trim(),
      fields: e.fields && typeof e.fields === "object" ? e.fields : {},
      body: String(e.body || ""),
      tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
      temporal: e.temporal && typeof e.temporal === "object" ? e.temporal : null,
    }));
}

export async function POST(request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const { text, filename, chunkIndex, totalChunks, existingTitles } = payload;

    const safeText = sanitizeForJSON(text);

    // Local validation: don't even call upstream
    if (!safeText || safeText.trim().length < 10) {
      return NextResponse.json({ entries: [], warning: "Empty/too short input" }, { status: 200 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Anthropic API key not configured", entries: [] }, { status: 500 });
    }

    let contextNote = "";
    const tc = Number(totalChunks || 1);
    const ci = Number.isFinite(Number(chunkIndex)) ? Number(chunkIndex) : 0;

    if (tc > 1) {
      contextNote = `\n\nThis is section ${ci + 1} of ${tc} from "${filename || "document"}". Extract only NEW distinct entities from THIS section.`;
    }
    if (Array.isArray(existingTitles) && existingTitles.length > 0) {
      contextNote += `\n\nEntities already extracted: ${existingTitles.join(
        ", "
      )}. Do NOT create duplicate entries for these — only create new ones or skip if this section adds nothing new.`;
    }

    const upstreamBody = {
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            "Parse this document section. Return ONLY a JSON array of codex entries." +
            contextNote +
            "\n\n" +
            safeText,
        },
      ],
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(upstreamBody),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      // Keep your 502 behavior for upstream failures, but include details.
      return NextResponse.json(
        { error: `AI API error ${response.status}`, details: errText, entries: [] },
        { status: 502 }
      );
    }

    const data = await response.json();
    const raw =
      Array.isArray(data.content) ? data.content.map((c) => c?.text || "").join("") : "";

    if (!raw || raw.trim().length === 0) {
      return NextResponse.json({ entries: [], warning: "Empty response" }, { status: 200 });
    }

    const parsed = extractJSON(raw, data.stop_reason === "max_tokens");
    if (!parsed) {
      return NextResponse.json(
        { entries: [], warning: "Could not parse response", rawPreview: raw.slice(0, 500) },
        { status: 200 }
      );
    }

    return NextResponse.json({ entries: cleanEntries(parsed) }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Unknown error", entries: [] },
      { status: 500 }
    );
  }
}
