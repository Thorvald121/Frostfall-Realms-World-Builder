// frostfall-deploy/frostfall-latest/app/api/ai-import/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // ensure Node runtime (fetch + env vars)

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

/**
 * Some imports contain invalid Unicode (unpaired surrogates) which can trigger 400 invalid_request_error.
 * Strip them so the JSON payload is always valid UTF-8.
 */
function sanitizeForJSON(s) {
  return String(s || "").replace(/[\uD800-\uDFFF]/g, "");
}

/**
 * Keep requests under conservative character limits to avoid provider/request-size validation errors.
 * (This is separate from model context; gateways can reject large bodies even if the model could handle it.)
 */
function clampText(s, maxChars) {
  const t = String(s || "");
  return t.length > maxChars ? t.slice(0, maxChars) : t;
}

/**
 * Remove common markdown artifacts from titles.
 */
function cleanTitle(title) {
  return String(title || "")
    .replace(/\{#[^}]*\}/g, "")
    .replace(/\.unnumbered\b/g, "")
    .trim();
}

/**
 * Best-effort JSON extraction from model output.
 */
function extractJSONArray(rawText) {
  let text = String(rawText || "").trim();

  // Strip code fences if the model disobeys
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // First attempt: direct parse
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // continue
  }

  // Second attempt: locate first balanced [...] region
  const start = text.indexOf("[");
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === "[") depth++;
      if (ch === "]") depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          // Try removing trailing commas
          try {
            return JSON.parse(slice.replace(/,\s*([\]}])/g, "$1"));
          } catch {
            return null;
          }
        }
      }
    }
  }

  // Third attempt: single object from first '{'
  const objStart = text.indexOf("{");
  if (objStart !== -1) {
    const obj = text.slice(objStart);
    try {
      return [JSON.parse(obj)];
    } catch {
      try {
        return [JSON.parse(obj.replace(/,\s*([\]}])/g, "$1"))];
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Normalize and filter entries so the frontend always receives consistent shapes.
 */
function normalizeEntries(entries) {
  const arr = Array.isArray(entries) ? entries : entries ? [entries] : [];
  return arr
    .filter((e) => e && typeof e === "object")
    .map((e) => ({
      title: cleanTitle(e.title),
      category: String(e.category || "").trim(),
      summary: String(e.summary || "").trim(),
      fields: e.fields && typeof e.fields === "object" ? e.fields : {},
      body: String(e.body || ""),
      tags: Array.isArray(e.tags) ? e.tags.map((t) => String(t)) : [],
      temporal: e.temporal && typeof e.temporal === "object" ? e.temporal : null,
    }))
    .filter((e) => e.title && e.category);
}

export async function POST(request) {
  try {
    const payload = await request.json().catch(() => ({}));

    const {
      text,
      filename,
      chunkIndex = 0,
      totalChunks = 1,
      existingTitles = [],
    } = payload || {};

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Anthropic API key not configured", entries: [] },
        { status: 500 }
      );
    }

    // Sanitize + clamp
    const MAX_CHARS = 120_000; // conservative; increase later if needed
    const safeText = clampText(sanitizeForJSON(text), MAX_CHARS);

    // Don’t call upstream for empty/too-short inputs
    if (!safeText || safeText.trim().length < 10) {
      return NextResponse.json(
        { entries: [], warning: "Empty/too short input" },
        { status: 200 }
      );
    }

    const tc = Number(totalChunks || 1);
    const ci = Number(chunkIndex || 0);

    let contextNote = "";
    if (tc > 1) {
      contextNote += `\n\nThis is section ${ci + 1} of ${tc} from "${filename || "document"}". Extract only NEW distinct entities from THIS section.`;
    }
    if (Array.isArray(existingTitles) && existingTitles.length > 0) {
      contextNote += `\n\nEntities already extracted: ${existingTitles.join(
        ", "
      )}. Do NOT create duplicate entries for these — only create new ones or skip if this section adds nothing new.`;
    }

    const userText =
      "Parse this document section. Return ONLY a JSON array of codex entries." +
      contextNote +
      "\n\n" +
      safeText;

    const upstreamBody = {
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          // Use block format (more robust with validators)
          content: [{ type: "text", text: userText }],
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

    // Surface upstream errors clearly; do NOT mask 4xx as 502
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      let errJson = null;
      try {
        errJson = JSON.parse(errText);
      } catch {
        // keep as text
      }

      const upstreamType =
        errJson?.error?.type || errJson?.type || "unknown_error";
      const upstreamMessage =
        errJson?.error?.message ||
        errJson?.message ||
        (typeof errText === "string" ? errText.slice(0, 2000) : "Unknown upstream error");

      return NextResponse.json(
        {
          error: `Anthropic ${response.status}`,
          upstreamType,
          upstreamMessage,
          details:
            typeof errText === "string" ? errText.slice(0, 4000) : String(errText),
          entries: [],
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Anthropic content is typically: [{type:"text", text:"..."}]
    const raw =
      Array.isArray(data?.content)
        ? data.content.map((c) => c?.text || "").join("")
        : "";

    if (!raw || raw.trim().length === 0) {
      return NextResponse.json(
        { entries: [], warning: "Empty response from AI" },
        { status: 200 }
      );
    }

    const parsed = extractJSONArray(raw);

    if (!parsed) {
      // Provide a preview for debugging without dumping everything
      return NextResponse.json(
        {
          entries: [],
          warning: "Could not parse AI response as JSON array",
          rawPreview: raw.slice(0, 1200),
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { entries: normalizeEntries(parsed) },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Unknown server error", entries: [] },
      { status: 500 }
    );
  }
}
