/**
 * documentParser.js — Client-side document parser for manual (offline) import.
 * Parses structured text (Markdown, plain text, DOCX-extracted text) into codex
 * entry objects without requiring any AI API. Entries go to Staging Area for review.
 *
 * Handles multiple document formats:
 *  - Markdown headings (# Title, ## Title)
 *  - Bold titles (**Title**)
 *  - ALL CAPS TITLES
 *  - Short standalone lines followed by body paragraphs
 *  - Separator-delimited sections (---, ===, ___)
 *  - Colon-header patterns (Title: or Name:)
 *  - Numbered entries (1. Title, I. Title)
 *  - Paragraph-gap heuristics as final fallback
 */

import { CATEGORIES, TEMPLATE_FIELDS } from "@/lib/domain/categories";

// Category detection keywords — weighted by specificity
const CATEGORY_SIGNALS = {
  deity: { weight: 3, terms: ["god", "goddess", "deity", "divine", "pantheon", "worship", "domain", "sacred", "temple", "prayer", "celestial", "court of", "creation"] },
  race: { weight: 3, terms: ["race", "species", "lifespan", "homeland", "mortal", "immortal", "elvish", "dwarven", "orcish", "magic affinity", "population", "physical characteristics", "aging", "elves", "dwarves", "lineage"] },
  character: { weight: 2, terms: ["born", "birth", "death", "titles", "affiliation", "hero", "villain", "king", "queen", "prince", "princess", "lord", "lady", "warrior", "mage", "wizard", "sorcerer", "knight", "companion"] },
  event: { weight: 3, terms: ["battle", "war", "siege", "treaty", "rebellion", "uprising", "fall of", "rise of", "founding of", "casualties", "aftermath", "conflict", "campaign", "great war"] },
  location: { weight: 2, terms: ["city", "town", "village", "kingdom", "realm", "region", "mountain", "forest", "river", "sea", "ocean", "fortress", "castle", "ruins", "capital", "province", "territory", "isle", "island"] },
  organization: { weight: 3, terms: ["guild", "order", "council", "faction", "brotherhood", "sisterhood", "alliance", "cult", "academy", "institution", "founded by", "headquarters", "chapter"] },
  item: { weight: 3, terms: ["sword", "blade", "staff", "ring", "amulet", "artifact", "weapon", "armor", "relic", "enchanted", "forged", "crafted", "power:", "legendary item"] },
  magic: { weight: 3, terms: ["magic", "spell", "enchantment", "arcane", "sorcery", "ritual", "mana", "weave", "school of", "cost:", "violation", "forbidden", "casting"] },
  language: { weight: 4, terms: ["language", "tongue", "dialect", "script", "alphabet", "grammar", "spoken by", "phrases", "writing system", "phonetic", "vocabulary", "translation"] },
  flora_fauna: { weight: 3, terms: ["creature", "beast", "plant", "herb", "flower", "tree", "predator", "prey", "habitat", "venomous", "domesticated", "wild", "fauna", "flora", "species"] },
  laws_customs: { weight: 3, terms: ["law", "custom", "tradition", "ritual", "ceremony", "taboo", "forbidden", "punishment", "penalty", "enforced", "cultural", "rite", "practice", "edict"] },
};

/**
 * Detect the most likely category for a text block.
 */
export function detectCategory(title, body) {
  const text = ((title || "") + " " + (body || "")).toLowerCase();
  const scores = {};
  let maxScore = 0;
  let bestCat = "character";

  for (const [cat, { weight, terms }] of Object.entries(CATEGORY_SIGNALS)) {
    let score = 0;
    for (const term of terms) {
      if (text.includes(term)) {
        score += weight;
        if ((title || "").toLowerCase().includes(term)) score += weight * 2;
      }
    }
    scores[cat] = score;
    if (score > maxScore) { maxScore = score; bestCat = cat; }
  }

  return { category: bestCat, confidence: maxScore > 0 ? Math.min(1, maxScore / 15) : 0, scores };
}

/**
 * Extract sub-heading fields from body text.
 */
function extractFields(bodyLines, category) {
  const fields = {};
  const templateFields = TEMPLATE_FIELDS[category] || [];
  const remainingBody = [];
  let currentField = null;
  let currentValue = [];

  const flushField = () => {
    if (currentField && currentValue.length > 0) {
      fields[currentField] = currentValue.join("\n").trim();
    }
    currentField = null;
    currentValue = [];
  };

  for (const line of bodyLines) {
    const subHeading = line.match(/^#{2,3}\s+(.+)/) || line.match(/^\*\*(.+?)\*\*\s*$/) || line.match(/^([A-Za-z][A-Za-z\s]{2,25}):\s*$/);
    if (subHeading) {
      flushField();
      const heading = subHeading[1].trim().toLowerCase();
      const matchedField = templateFields.find((f) => {
        const fieldName = f.replace(/_/g, " ").toLowerCase();
        return heading.includes(fieldName) || fieldName.includes(heading);
      });
      if (matchedField) {
        currentField = matchedField;
      } else {
        remainingBody.push(line);
      }
    } else if (currentField) {
      currentValue.push(line);
    } else {
      remainingBody.push(line);
    }
  }
  flushField();

  // Also try inline "Key: Value" patterns on single lines
  for (const line of remainingBody) {
    const kvMatch = line.match(/^([A-Za-z][A-Za-z\s_]{2,25}):\s+(.+)/);
    if (kvMatch) {
      const key = kvMatch[1].trim().toLowerCase();
      const val = kvMatch[2].trim();
      const matchedField = templateFields.find((f) => {
        const fieldName = f.replace(/_/g, " ").toLowerCase();
        return key === fieldName || key.includes(fieldName) || fieldName.includes(key);
      });
      if (matchedField && !fields[matchedField]) {
        fields[matchedField] = val;
      }
    }
  }

  return { fields, body: remainingBody.join("\n").trim() };
}

/** Extract tags from text */
function extractTags(text) {
  const tags = new Set();
  const hashTags = text.match(/#(\w[\w-]*)/g);
  if (hashTags) hashTags.forEach((t) => tags.add(t.slice(1).toLowerCase()));
  const bracketTags = text.match(/\[(\w[\w\s-]*)\]/g);
  if (bracketTags) bracketTags.forEach((t) => {
    const inner = t.slice(1, -1).trim().toLowerCase();
    if (inner.length < 20 && inner.length > 1) tags.add(inner);
  });
  return [...tags].slice(0, 10);
}

/** Try to extract temporal data from text */
function extractTemporal(text, category) {
  const temporal = { type: "concept", active_start: null, active_end: null, birth_year: null, death_year: null };
  if (category === "deity") temporal.type = "immortal";
  else if (category === "race") temporal.type = "race";
  else if (category === "character") temporal.type = "mortal";
  else if (category === "event") temporal.type = "event";

  const birthMatch = text.match(/(?:born|birth|began|founded|created|started)\s*(?:in\s*)?(?:year\s*)?(\d{1,5})/i);
  const deathMatch = text.match(/(?:died|death|ended|fell|destroyed|dissolved)\s*(?:in\s*)?(?:year\s*)?(\d{1,5})/i);

  if (birthMatch) { const y = parseInt(birthMatch[1]); temporal.active_start = y; if (category === "character") temporal.birth_year = y; }
  if (deathMatch) { const y = parseInt(deathMatch[1]); temporal.active_end = y; if (category === "character") temporal.death_year = y; }
  return (temporal.active_start || temporal.active_end) ? temporal : null;
}

/** Generate a snake_case ID from a title */
function titleToId(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "").replace(/^_+/, "") || "entry_" + Date.now();
}

// --- Section Detection Strategies ---

/**
 * Determine if a line looks like a section title/heading.
 * Returns the cleaned title string or null.
 */
function detectTitle(line, nextLine, prevLineBlank) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Strategy 1: Markdown headings
  const md = trimmed.match(/^#{1,3}\s+(.+)/);
  if (md) return md[1].replace(/\{#[^}]*\}/g, "").replace(/\.unnumbered/g, "").trim();

  // Strategy 2: Bold markers
  const bold = trimmed.match(/^\*\*(.+?)\*\*\s*$/);
  if (bold) return bold[1].trim();

  // Strategy 3: ALL CAPS lines (at least 3 chars, mostly letters)
  if (/^[A-Z][A-Z\s,'''"-]{2,60}$/.test(trimmed) && trimmed.replace(/[^A-Z]/g, "").length >= 3) {
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount <= 8) return trimmed;
  }

  // Strategy 4: Numbered entries (1. Title, I. Title, A. Title)
  const numbered = trimmed.match(/^(?:\d{1,3}|[IVXLC]+|[A-Z])[\.\)]\s+(.{3,60})$/);
  if (numbered && prevLineBlank) return numbered[1].trim();

  // Strategy 5: Short line preceded by blank, not ending with common punctuation,
  // followed by longer content — classic "title then body" pattern
  if (prevLineBlank && trimmed.length <= 60 && trimmed.length >= 3
      && !/[.,;!?)\]]$/.test(trimmed)
      && nextLine && nextLine.trim().length > trimmed.length) {
    const words = trimmed.split(/\s+/);
    if (words.length <= 6) {
      const hasCapWords = words.filter((w) => /^[A-Z"']/.test(w)).length >= Math.ceil(words.length / 2);
      if (hasCapWords) return trimmed;
    }
  }

  // Strategy 6: Underlined titles (line followed by === or ---)
  if (nextLine && /^[=]{3,}$/.test(nextLine.trim())) return trimmed;
  if (nextLine && /^[-]{3,}$/.test(nextLine.trim()) && trimmed.length > 2) return trimmed;

  return null;
}

/**
 * Split raw text into sections using multiple detection strategies.
 */
function splitIntoSections(text) {
  const rawLines = text.split("\n");
  const sections = [];
  let current = { title: "", lines: [] };
  let preambleLines = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const nextLine = i + 1 < rawLines.length ? rawLines[i + 1] : null;
    const prevBlank = i === 0 || rawLines[i - 1].trim() === "";

    // Skip separator lines themselves
    if (/^[-=_]{3,}\s*$/.test(line.trim())) continue;

    const title = detectTitle(line, nextLine, prevBlank);

    if (title) {
      if (current.title && (current.lines.length > 0 || current.title)) {
        sections.push({ ...current });
      } else if (current.lines.length > 0 && !current.title) {
        preambleLines = [...preambleLines, ...current.lines];
      }
      current = { title, lines: [] };

      // Skip underline if next line is === or ---
      if (nextLine && /^[-=]{3,}$/.test(nextLine.trim())) i++;
    } else {
      current.lines.push(line);
    }
  }

  if (current.title) {
    sections.push(current);
  } else if (current.lines.length > 0) {
    preambleLines = [...preambleLines, ...current.lines];
  }

  return { sections, preambleLines };
}

/**
 * Fallback: split by double blank lines (paragraph gaps).
 */
function splitByParagraphGaps(text) {
  const blocks = text.split(/\n\s*\n\s*\n/).map((b) => b.trim()).filter((b) => b.length > 20);
  if (blocks.length <= 1) return [];

  return blocks.map((block) => {
    const lines = block.split("\n");
    const firstLine = lines[0].trim();
    if (firstLine.length <= 60 && firstLine.length >= 3 && lines.length > 1) {
      return { title: firstLine.replace(/^\*\*|\*\*$/g, "").trim(), lines: lines.slice(1) };
    }
    const titleWords = firstLine.split(/\s+/).slice(0, 5).join(" ");
    return { title: titleWords + (firstLine.split(/\s+/).length > 5 ? "..." : ""), lines };
  });
}

/**
 * Last-resort: split by single blank line groups.
 */
function splitByParagraphs(text) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b.length > 30);
  if (blocks.length <= 1) return [];

  return blocks.map((block, i) => {
    const lines = block.split("\n");
    const firstLine = lines[0].trim();
    const title = (firstLine.length <= 60 && firstLine.length >= 3)
      ? firstLine.replace(/^\*\*|\*\*$/g, "").replace(/^[-*]\s*/, "").trim()
      : "Section " + (i + 1);
    return { title, lines: firstLine.length <= 60 ? lines.slice(1) : lines };
  });
}


// --- Main Parser ---

/**
 * Main parser: takes raw text content and returns an array of codex entry objects.
 *
 * @param {string} text - raw document text
 * @param {string} filename - source filename
 * @returns {{ entries: Array, warnings: string[] }}
 */
export function parseDocument(text, filename = "document") {
  if (!text || text.trim().length < 20) {
    return { entries: [], warnings: ["Document is empty or too short to parse."] };
  }

  const entries = [];
  const warnings = [];

  // Phase 1: Try structured section detection
  let { sections, preambleLines } = splitIntoSections(text);

  // Phase 2: If too few sections, try paragraph gap splitting
  if (sections.length <= 1) {
    const gapSections = splitByParagraphGaps(text);
    if (gapSections.length > sections.length) {
      sections = gapSections;
      preambleLines = [];
      warnings.push("No clear headings found - split by paragraph gaps. Review entry titles in staging.");
    }
  }

  // Phase 3: If still too few, try single-paragraph splitting
  if (sections.length <= 1) {
    const paraSections = splitByParagraphs(text);
    if (paraSections.length > 1) {
      sections = paraSections;
      preambleLines = [];
      warnings.push("Minimal structure detected - each paragraph treated as a potential entry. Review carefully.");
    }
  }

  // Phase 4: Last resort - single entry from filename
  if (sections.length === 0) {
    const title = filename.replace(/\.\w+$/, "").replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    sections = [{ title, lines: text.split("\n") }];
    warnings.push("No structure found - imported as a single entry. Consider adding headings to your document.");
  }

  // Attach preamble to first section
  if (preambleLines.length > 0 && sections.length > 0) {
    sections[0].lines = [...preambleLines, "", ...sections[0].lines];
  }

  // Process each section into an entry
  const seenTitles = new Set();
  for (const section of sections) {
    let title = section.title
      .replace(/\{#[^}]*\}/g, "")
      .replace(/\.unnumbered/g, "")
      .replace(/^\*\*|\*\*$/g, "")
      .replace(/^\d+\.\s*/, "")
      .replace(/^[IVXLC]+[\.\)]\s*/, "")
      .trim();

    if (!title || title.length < 2) continue;
    if (/^(table of contents|introduction|conclusion|appendix|index|bibliography|references|foreword|preface|acknowledgements?)$/i.test(title)) continue;

    const titleKey = title.toLowerCase();
    if (seenTitles.has(titleKey)) {
      warnings.push('Skipped duplicate: "' + title + '"');
      continue;
    }
    seenTitles.add(titleKey);

    const rawBody = section.lines.join("\n").trim();
    if (!rawBody || rawBody.length < 10) {
      warnings.push('Skipped "' + title + '" - too little content.');
      continue;
    }

    const { category, confidence } = detectCategory(title, rawBody);
    if (confidence < 0.1) {
      warnings.push('"' + title + '" - auto-detected as "' + (CATEGORIES[category]?.label || category) + '" (low confidence). You may want to change it.');
    }

    const firstLine = rawBody.split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("**"));
    const summary = firstLine ? firstLine.replace(/^[-*]\s*/, "").trim().slice(0, 200) : "";

    const { fields, body } = extractFields(section.lines, category);
    const tags = extractTags(rawBody);
    const temporal = extractTemporal(title + " " + rawBody, category);

    entries.push({
      id: titleToId(title),
      title,
      category,
      summary,
      fields,
      body: body || rawBody,
      tags,
      temporal,
      linkedIds: [],
      portrait: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _stagingId: Date.now() + "-manual-" + entries.length,
      _status: "pending",
      _source: "manual",
      _confidence: confidence,
    });
  }

  if (entries.length === 0) {
    warnings.push("No entries could be extracted. Try adding headings (# Title) or separating sections with blank lines.");
  }

  return { entries, warnings };
}