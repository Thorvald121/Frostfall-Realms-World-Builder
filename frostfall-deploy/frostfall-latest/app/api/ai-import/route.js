import { NextResponse } from "next/server";

/**
 * Frostfall Realms — AI Import Route (Hardened)
 * - Sequential chunk-based parsing is handled client-side.
 * - This route handles provider calls + retries + graceful fallback.
 *
 * Payload expected (from FrostfallRealms.jsx):
 * {
 *   text, filename, chunkIndex, totalChunks, existingTitles,
 *   provider, model, userApiKey
 * }
 */

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

// -------------------------
// Novel AI Assist System Prompt
// -------------------------
const NOVEL_SYSTEM = `You are a skilled fiction writer and editor assisting with a fantasy novel. You write in a literary, immersive style with vivid sensory details. You match the voice and tone of the existing text. You NEVER break the fourth wall or mention that you are an AI. You respond ONLY with the requested creative content — no preamble, no explanation, no markdown formatting.`;

const NOVEL_ACTION_PROMPTS = {
  continue: (ctx, sel) =>
    `Continue writing the next 150-300 words of this scene. Match the existing tone, pacing, and voice exactly.\n\nWorld: ${ctx.world || "Fantasy world"}\nLocation: ${ctx.actTitle || ""} → ${ctx.chapterTitle || ""} → ${ctx.sceneTitle || ""}\n${ctx.codexContext ? "\nRelevant lore:\n" + ctx.codexContext : ""}\n\nScene so far (last portion):\n${ctx.sceneText || "(empty scene)"}`,
  describe: (ctx, sel) =>
    `Write a vivid 100-200 word scene description/setting passage that could be inserted into this scene. Use sensory details — sight, sound, smell, texture.\n\nWorld: ${ctx.world || "Fantasy world"}\nScene: ${ctx.sceneTitle || "Untitled"}\n${ctx.codexContext ? "\nRelevant lore:\n" + ctx.codexContext : ""}\n\nCurrent scene text:\n${ctx.sceneText || "(empty scene)"}`,
  rewrite: (ctx, sel) =>
    `Rewrite the following passage to improve clarity, flow, and impact while preserving the original meaning and voice:\n\nPassage to rewrite:\n${sel}`,
  expand: (ctx, sel) =>
    `Expand the following passage to roughly double its length. Add sensory details, internal thoughts, or dialogue beats while preserving the tone:\n\nPassage to expand:\n${sel}`,
  dialogue: (ctx, sel) =>
    `Polish the following dialogue. Improve naturalness, subtext, and character voice. Keep action beats. Make each character sound distinct:\n\nDialogue to polish:\n${sel}`,
};

// -------------------------
// Proofread System Prompt
// -------------------------
const PROOFREAD_SYSTEM = `You are a meticulous proofreader for fiction manuscripts. Analyze the text and return ONLY a JSON array of issues found. Each issue object must have:
- "type": one of "grammar", "spelling", "punctuation", "style", "clarity"  
- "original": the exact problematic text (verbatim from input)
- "suggestion": the corrected text
- "explanation": brief reason (under 20 words)

Rules:
- Do NOT flag stylistic choices common in fiction (fragments for effect, unusual dialogue formatting)
- Do NOT flag fantasy names, places, or invented words
- Focus on genuine errors: typos, subject-verb disagreement, missing punctuation, unclear antecedents
- Return an empty array [] if no issues found
- Return ONLY the JSON array, no markdown fences, no explanation text`;

// -------------------------
// Small utilities
// -------------------------

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function clampText(s, maxChars) {
  const str = typeof s === "string" ? s : s == null ? "" : String(s);
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars);
}

function sanitizeForJSON(s) {
  // Remove null bytes and normalize newlines; keep content readable.
  const str = typeof s === "string" ? s : s == null ? "" : String(s);
  return str.replace(/\u0000/g, "").replace(/\r\n/g, "\n");
}

function cleanTitle(title) {
  return String(title || "")
    .replace(/\{#[^}]*\}/g, "")
    .replace(/\.unnumbered/g, "")
    .trim();
}

function safeString(x, max = 4000) {
  const s =
    typeof x === "string"
      ? x
      : x == null
        ? ""
        : (() => {
            try {
              return JSON.stringify(x);
            } catch {
              return String(x);
            }
          })();
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Tries hard to extract a JSON array from raw text.
 * Returns: array | null
 */
function extractJSONArray(raw, wasTruncated) {
  const text = typeof raw === "string" ? raw : "";
  let jsonText = text;

  // If we hit max tokens, sometimes the array is cut off; try to close it.
  if (wasTruncated) {
    const lastObj = jsonText.lastIndexOf("}");
    if (lastObj !== -1) jsonText = jsonText.slice(0, lastObj + 1) + "]";
  }

  // Strip code fences if present.
  jsonText = jsonText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // Direct parse attempt.
  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {}

  // Attempt to locate the first array slice and parse it.
  const start = jsonText.indexOf("[");
  if (start !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = start; i < jsonText.length; i++) {
      if (jsonText[i] === "[") depth++;
      if (jsonText[i] === "]") depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    if (end !== -1) {
      const slice = jsonText.slice(start, end + 1);
      try {
        const parsed = JSON.parse(slice);
        return Array.isArray(parsed) ? parsed : null;
      } catch (_) {
        // Try removing trailing commas.
        try {
          const repaired = slice.replace(/,\s*([\]}])/g, "$1");
          const parsed = JSON.parse(repaired);
          return Array.isArray(parsed) ? parsed : null;
        } catch (_) {}
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

/**
 * Option B fallback:
 * Return a single “raw import” entry that is usable in staging.
 * Category is a normal codex category so the UI can reassign it.
 */
function makeRawFallbackEntry({ safeText, filename, chunkIndex, totalChunks, reason }) {
  const tc = Number(totalChunks || 1);
  const ci = Number(chunkIndex || 0);
  const sectionLabel = tc > 1 ? ` — Section ${ci + 1}/${tc}` : "";
  const cleanName = filename ? String(filename) : "Document";

  return normalizeEntries([
    {
      title: `Raw Import — ${cleanName}${sectionLabel}`,
      category: "event",
      summary: `AI parsing unavailable. Raw text preserved for manual staging edits. (${reason})`,
      fields: {
        source_filename: cleanName,
        source_chunk_index: ci,
        source_total_chunks: tc,
        import_mode: "raw_fallback",
        failure_reason: reason,
      },
      body: String(safeText || ""),
      tags: ["raw_import", "needs_review"],
      temporal: null,
    },
  ])[0];
}

// -------------------------
// Provider callers (fetch-based, deterministic)
// -------------------------

async function callAnthropic(apiKey, model, systemPrompt, userMessage) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  const retryAfter = response.headers.get("retry-after");
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    const err = new Error(`Anthropic API error ${response.status}: ${safeString(errText, 1200)}`);
    err.status = response.status;
    err.retryAfter = retryAfter;
    err.body = errText;
    throw err;
  }

  const data = await response.json();
  const raw = data.content?.map((c) => c.text || "").join("") || "";
  const truncated = data.stop_reason === "max_tokens";
  return { raw, truncated };
}

async function callOpenAI(apiKey, model, systemPrompt, userMessage) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  const retryAfter = response.headers.get("retry-after");
  if (!response.ok) {
    const errText = await response.text().catch(() => "");

    // OpenAI reuses 429 for both rate limits and quota exhaustion.
    // Distinguish them so retry logic doesn't pointlessly retry billing errors.
    if (response.status === 429) {
      let errorCode = "";
      try { errorCode = JSON.parse(errText)?.error?.code || ""; } catch {}
      if (errorCode === "insufficient_quota") {
        const err = new Error(
          "OpenAI quota exceeded — this is a billing/spending cap, not a rate limit. " +
          "Your API key may have credits, but the project or organization has a separate " +
          "monthly spending limit. Check: https://platform.openai.com/settings/organization/limits"
        );
        err.status = 402; // Reclassify as non-retryable
        err.quotaError = true;
        err.body = errText;
        throw err;
      }
    }

    const err = new Error(`OpenAI API error ${response.status}: ${safeString(errText, 1200)}`);
    err.status = response.status;
    err.retryAfter = retryAfter;
    err.body = errText;
    throw err;
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const truncated = data.choices?.[0]?.finish_reason === "length";
  return { raw, truncated };
}

async function callGoogle(apiKey, model, systemPrompt, userMessage) {
  const modelId = model || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 8192 },
    }),
  });

  const retryAfter = response.headers.get("retry-after");
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    const err = new Error(`Google API error ${response.status}: ${safeString(errText, 1200)}`);
    err.status = response.status;
    err.retryAfter = retryAfter;
    err.body = errText;
    throw err;
  }

  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const truncated = data.candidates?.[0]?.finishReason === "MAX_TOKENS";
  return { raw, truncated };
}

const PROVIDERS = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  google: callGoogle,
};

// -------------------------
// Retry / Backoff logic
// -------------------------

function parseRetryAfterMs(retryAfterHeader) {
  if (!retryAfterHeader) return null;
  // Retry-After can be seconds or a HTTP date; we’ll support seconds deterministically.
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  return null;
}

function isRetryableStatus(status) {
  if (!status) return false;
  return status === 429 || status >= 500;
}

async function callWithRetry({ caller, apiKey, model, systemPrompt, userMessage }) {
  const MAX_ATTEMPTS = 3;
  const BASE_DELAY_MS = 750;

  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await caller(apiKey, model, systemPrompt, userMessage);
    } catch (err) {
      lastErr = err;
      const status = err?.status;
      const retryable = isRetryableStatus(status);

      // Not retryable -> bail immediately.
      if (!retryable) throw err;

      // If this was the last attempt -> throw.
      if (attempt === MAX_ATTEMPTS) throw err;

      // Respect Retry-After if present, else exponential backoff.
      const retryAfterMs = parseRetryAfterMs(err?.retryAfter);
      const backoffMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      const delayMs = retryAfterMs != null ? retryAfterMs : Math.min(backoffMs, 8000);

      await sleep(delayMs);
    }
  }

  throw lastErr || new Error("Unknown upstream error");
}

// -------------------------
// Route
// -------------------------

export async function POST(request) {
  try {
    const payload = await request.json().catch(() => ({}));

    const {
      text,
      filename,
      chunkIndex = 0,
      totalChunks = 1,
      existingTitles = [],
      provider,
      model,
      userApiKey,
      // Novel writing assistant fields
      novelAssistMode,
      novelAssistAction,
      novelContext,
      novelSelection,
      // Proofread fields
      proofreadMode,
    } = payload || {};

    const providerId = String(provider || "anthropic").toLowerCase();
    const caller = PROVIDERS[providerId] || PROVIDERS.anthropic;

    // Resolve API key: user key overrides env key.
    let apiKey = typeof userApiKey === "string" ? userApiKey : "";
    if (!apiKey) {
      if (providerId === "anthropic") apiKey = process.env.ANTHROPIC_API_KEY || "";
      else if (providerId === "openai") apiKey = process.env.OPENAI_API_KEY || "";
      else if (providerId === "google") apiKey = process.env.GOOGLE_API_KEY || "";
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: `No API key configured for ${providerId}. Add one in Settings → API Keys.`, entries: [] },
        { status: 400 }
      );
    }

    // ─────────────────────────────────────────────
    // MODE: Novel Writing Assistant
    // ─────────────────────────────────────────────
    if (novelAssistMode) {
      const action = String(novelAssistAction || "continue");
      const ctx = novelContext || {};
      const sel = novelSelection || "";
      const promptFn = NOVEL_ACTION_PROMPTS[action] || NOVEL_ACTION_PROMPTS.continue;
      const userMessage = promptFn(ctx, sel);

      try {
        const upstream = await callWithRetry({
          caller,
          apiKey,
          model: typeof model === "string" && model.trim() ? model.trim() : undefined,
          systemPrompt: NOVEL_SYSTEM,
          userMessage,
        });
        const raw = upstream?.raw || "";
        return NextResponse.json({ novelAssist: raw.trim() }, { status: 200 });
      } catch (err) {
        return NextResponse.json(
          { error: safeString(err?.message || "Novel assist failed", 400), novelAssist: "" },
          { status: 200 }
        );
      }
    }

    // ─────────────────────────────────────────────
    // MODE: Proofread
    // ─────────────────────────────────────────────
    if (proofreadMode) {
      const safeText = clampText(sanitizeForJSON(text), 60000);
      if (!safeText || safeText.trim().length < 10) {
        return NextResponse.json({ suggestions: [] }, { status: 200 });
      }
      try {
        const upstream = await callWithRetry({
          caller,
          apiKey,
          model: typeof model === "string" && model.trim() ? model.trim() : undefined,
          systemPrompt: PROOFREAD_SYSTEM,
          userMessage: "Proofread this fiction text and return a JSON array of issues:\n\n" + safeText,
        });
        const raw = upstream?.raw || "";
        // Try to parse as JSON array
        let suggestions = [];
        try {
          const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed)) suggestions = parsed;
        } catch { /* If AI didn't return valid JSON, return empty */ }
        return NextResponse.json({ suggestions }, { status: 200 });
      } catch (err) {
        return NextResponse.json(
          { error: safeString(err?.message || "Proofread failed", 400), suggestions: [] },
          { status: 200 }
        );
      }
    }

    // ─────────────────────────────────────────────
    // MODE: Document Import (default)
    // ─────────────────────────────────────────────
    const MAX_CHARS = 120_000;
    const safeText = clampText(sanitizeForJSON(text), MAX_CHARS);

    if (!safeText || safeText.trim().length < 10) {
      return NextResponse.json({ entries: [], warning: "Empty/too short input" }, { status: 200 });
    }

    const tc = Number(totalChunks || 1);
    const ci = Number(chunkIndex || 0);

    let contextNote = "";
    if (tc > 1) {
      contextNote += `\n\nThis is section ${ci + 1} of ${tc} from "${filename || "document"}". Extract only NEW distinct entities from THIS section.`;
    }
    if (Array.isArray(existingTitles) && existingTitles.length > 0) {
      contextNote += `\n\nEntities already extracted: ${existingTitles.join(", ")}. Do NOT create duplicate entries for these — only create new ones or skip if this section adds nothing new.`;
    }

    const userText =
      "Parse this document section. Return ONLY a JSON array of codex entries." +
      contextNote +
      "\n\n" +
      safeText;

    // Call provider with retry/backoff on 429 + 5xx.
    let upstream;
    try {
      upstream = await callWithRetry({
        caller,
        apiKey,
        model: typeof model === "string" && model.trim() ? model.trim() : undefined,
        systemPrompt: SYSTEM_PROMPT,
        userMessage: userText,
      });
    } catch (err) {
      const status = err?.status;
      const reason =
        status === 402 ? "quota_exceeded" : status === 429 ? "rate_limited_429" : status >= 500 ? `provider_${status}` : "provider_error";

      const fallbackEntry = makeRawFallbackEntry({
        safeText,
        filename,
        chunkIndex: ci,
        totalChunks: tc,
        reason,
      });

      const warning =
        status === 402
          ? "OpenAI spending cap reached. Check your project limits at platform.openai.com/settings/organization/limits"
          : status === 429
            ? "AI provider rate-limited (429). Raw import used for this section."
            : "AI provider error. Raw import used for this section.";

      return NextResponse.json(
        {
          entries: [fallbackEntry],
          warning,
          fallbackUsed: true,
          fallbackReason: reason,
          provider: providerId,
        },
        { status: 200 }
      );
    }

    const raw = upstream?.raw || "";
    const truncated = !!upstream?.truncated;

    if (!raw || raw.trim().length === 0) {
      const fallbackEntry = makeRawFallbackEntry({
        safeText,
        filename,
        chunkIndex: ci,
        totalChunks: tc,
        reason: "empty_ai_response",
      });

      return NextResponse.json(
        {
          entries: [fallbackEntry],
          warning: "Empty response from AI. Raw import used for this section.",
          fallbackUsed: true,
          fallbackReason: "empty_ai_response",
          provider: providerId,
        },
        { status: 200 }
      );
    }

    const parsed = extractJSONArray(raw, truncated);

    // If AI returned non-JSON or malformed JSON, keep the user's text instead of failing hard.
    if (!parsed) {
      const fallbackEntry = makeRawFallbackEntry({
        safeText,
        filename,
        chunkIndex: ci,
        totalChunks: tc,
        reason: "unparseable_ai_json",
      });

      return NextResponse.json(
        {
          entries: [fallbackEntry],
          warning: "AI response could not be parsed as JSON. Raw import used for this section.",
          fallbackUsed: true,
          fallbackReason: "unparseable_ai_json",
          provider: providerId,
          rawPreview: raw.slice(0, 600),
        },
        { status: 200 }
      );
    }

    const normalized = normalizeEntries(parsed);

    if (!normalized || normalized.length === 0) {
      // AI returned JSON but no valid entries -> still preserve raw text.
      const fallbackEntry = makeRawFallbackEntry({
        safeText,
        filename,
        chunkIndex: ci,
        totalChunks: tc,
        reason: "no_valid_entries",
      });

      return NextResponse.json(
        {
          entries: [fallbackEntry],
          warning: "AI returned no usable entries. Raw import used for this section.",
          fallbackUsed: true,
          fallbackReason: "no_valid_entries",
          provider: providerId,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ entries: normalized, provider: providerId, fallbackUsed: false }, { status: 200 });
  } catch (err) {
    // Catch-all: keep shape stable, but do NOT throw objects into the client.
    return NextResponse.json(
      { error: safeString(err?.message || err || "Unknown server error", 800), entries: [] },
      { status: 500 }
    );
  }
}