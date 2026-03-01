/**
 * writingTools.js — Writing assistance utilities for the novel editor.
 *
 * Layer 1: Browser spellcheck (enabled via spellCheck={true} on contentEditable)
 * Layer 2: checkWord() — client-side autocorrect dictionary
 * Layer 3: aiProofread() — AI-powered proofreading via configured provider
 *
 * Exports: checkWord, aiProofread, SUGGESTION_STYLES
 */

// ═══════════════════════════════════════════════════════════════
//  SUGGESTION_STYLES — Visual styling for proofread suggestion types
// ═══════════════════════════════════════════════════════════════

export const SUGGESTION_STYLES = {
  grammar:      { color: "#7ec8e3", icon: "📝" },
  spelling:     { color: "#e07050", icon: "✏️" },
  punctuation:  { color: "#c084fc", icon: "·" },
  style:        { color: "#f0c050", icon: "✦" },
  clarity:      { color: "#8ec8a0", icon: "💡" },
};

// ═══════════════════════════════════════════════════════════════
//  AUTOCORRECT DICTIONARY — Layer 2
// ═══════════════════════════════════════════════════════════════

const AUTOCORRECT_MAP = {
  // Common typos
  "teh": "the", "hte": "the", "adn": "and", "ahve": "have",
  "taht": "that", "thier": "their", "thsi": "this", "wiht": "with",
  "waht": "what", "whihc": "which", "wich": "which",
  "becuase": "because", "becasue": "because",
  "recieve": "receive", "acheive": "achieve", "occured": "occurred",
  "seperate": "separate", "definately": "definitely",
  "occassion": "occasion", "neccessary": "necessary",
  "accomodate": "accommodate", "embarass": "embarrass",
  "goverment": "government", "enviroment": "environment",
  "knowlege": "knowledge", "persue": "pursue",
  "tommorow": "tomorrow", "untill": "until",
  "alot": "a lot", "calender": "calendar",
  "prolly": "probably", "noone": "no one",
  "realy": "really", "truely": "truly", "basicly": "basically",
  "definatly": "definitely", "succesful": "successful",
  "occurance": "occurrence", "wierd": "weird",
  "gaurd": "guard", "freind": "friend",
  "concious": "conscious", "concience": "conscience",
  "manuever": "maneuver", "suprise": "surprise",
  "relevent": "relevant", "existance": "existence",
  "refrence": "reference", "prefered": "preferred",
  "grammer": "grammar", "arguement": "argument",
  "independant": "independent", "maintainance": "maintenance",
  "priviledge": "privilege", "pronounciation": "pronunciation",
  "rediculous": "ridiculous", "shedule": "schedule",
  "temperture": "temperature", "tomatos": "tomatoes",
  "writting": "writing", "acheiving": "achieving",
  // Contraction fixes
  "doesnt": "doesn't", "dont": "don't", "cant": "can't",
  "wont": "won't", "didnt": "didn't", "isnt": "isn't",
  "hasnt": "hasn't", "hadnt": "hadn't", "wouldnt": "wouldn't",
  "couldnt": "couldn't", "shouldnt": "shouldn't", "wasnt": "wasn't",
  "werent": "weren't", "youre": "you're", "theyre": "they're",
  "heres": "here's", "theres": "there's", "wheres": "where's",
  "whats": "what's", "whos": "who's",
  "thats": "that's",
  "weve": "we've", "theyve": "they've", "youve": "you've",
  "wouldve": "would've", "couldve": "could've", "shouldve": "should've",
  // Standalone i
  "i": "I",
  // I-contractions
  "ive": "I've", "im": "I'm",
};

// Words that are valid English and should NOT be autocorrected
// even though they look like they could be contractions
const CONTEXT_EXCEPTIONS = new Set([
  "its",  // possessive (its color) vs contraction (it's raining)
  "were", // past tense (they were) vs contraction (we're)
  "ill",  // adjective (he felt ill) vs contraction (I'll)
  "id",   // noun (show your id) vs contraction (I'd)
  "lets", // verb (she lets him go) vs contraction (let's)
  "well", // adverb/adjective vs contraction (we'll)
  "wed",  // past tense (they wed) vs contraction (we'd)
  "shell",// noun (a shell) vs contraction (she'll)
  "hell", // noun (hell) vs contraction (he'll)
  "whos", // already ambiguous
]);

/**
 * Check a word against the autocorrect dictionary.
 * Returns the corrected word if found, or the original word unchanged.
 *
 * @param {string} word — The word to check
 * @returns {string} — Corrected word or original if no match
 */
export function checkWord(word) {
  if (!word || word.length < 2) return word;

  // Strip trailing punctuation for lookup
  const punctMatch = word.match(/^(.+?)([.,!?;:…"'"»\u201C\u201D\u2018\u2019]+)$/);
  const cleanWord = punctMatch ? punctMatch[1] : word;
  const trailing = punctMatch ? punctMatch[2] : "";

  const lower = cleanWord.toLowerCase();

  // Skip context-dependent exceptions
  if (CONTEXT_EXCEPTIONS.has(lower)) return word;

  const correction = AUTOCORRECT_MAP[lower];
  if (!correction) return word;

  // Preserve original capitalization pattern
  let result = correction;
  if (cleanWord === cleanWord.toUpperCase() && cleanWord.length > 1) {
    // ALL CAPS → ALL CAPS correction
    result = correction.toUpperCase();
  } else if (cleanWord[0] === cleanWord[0].toUpperCase() && cleanWord.length > 1) {
    // Title Case → Title case correction
    result = correction[0].toUpperCase() + correction.slice(1);
  }

  return result + trailing;
}

// ═══════════════════════════════════════════════════════════════
//  AI PROOFREAD — Layer 3
// ═══════════════════════════════════════════════════════════════

/**
 * Send scene text to the configured AI provider for proofreading.
 * Returns suggestions with { original, suggestion, explanation, type }.
 *
 * @param {string} text — Plain text content of the scene
 * @param {Object} settings — User settings with aiProvider, aiKeys, aiModel
 * @returns {Promise<{ suggestions: Array, error?: string }>}
 */
export async function aiProofread(text, settings) {
  const provider = settings.aiProvider || "anthropic";
  const apiKey = settings.aiKeys?.[provider];
  const model = settings.aiModel?.[provider];

  if (!apiKey) {
    return { suggestions: [], error: "No API key configured. Add one in Settings → API Keys." };
  }

  if (!text || text.trim().length < 10) {
    return { suggestions: [], error: "Scene text is too short to proofread." };
  }

  try {
    const response = await fetch("/api/ai-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model,
        userApiKey: apiKey,
        proofreadText: text.slice(0, 8000),
        proofreadMode: true,
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      return { suggestions: [], error: errBody.error || ("API error " + response.status) };
    }

    const data = await response.json();

    if (data.error) {
      return { suggestions: [], error: data.error };
    }

    // Normalize suggestions — handle various field names AI might use
    const raw = Array.isArray(data.proofread) ? data.proofread : [];
    const suggestions = raw
      .filter((s) => s && typeof s === "object" && s.original)
      .map((s) => ({
        original: String(s.original || ""),
        suggestion: String(s.suggestion || s.corrected || s.replacement || s.fixed || ""),
        explanation: String(s.explanation || s.reason || s.note || ""),
        type: ["grammar", "spelling", "punctuation", "style", "clarity"].includes(s.type)
          ? s.type : "grammar",
      }))
      .filter((s) => s.suggestion && s.original !== s.suggestion);

    return { suggestions };
  } catch (err) {
    return { suggestions: [], error: err.message || "Network error" };
  }
}

/**
 * AI Novel Writing Assistant — calls the API with novel context
 * @param {string} action - "continue" | "rewrite" | "describe" | "expand" | "dialogue"
 * @param {object} context - { worldName, actTitle, chapterTitle, sceneTitle, sceneText, codexContext }
 * @param {string|null} selection - selected text (for rewrite/expand/dialogue)
 * @param {object} settings - app settings with aiKeys, aiProvider, aiModel
 * @returns {{ text: string, error?: string }}
 */
export async function aiNovelAssist(action, context, selection, settings) {
  const provider = settings.aiProvider || "anthropic";
  const apiKey = settings.aiKeys?.[provider];
  if (!apiKey) return { text: "", error: "No API key for " + provider };

  try {
    const res = await fetch("/api/ai-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        userApiKey: apiKey,
        model: settings.aiModel?.[provider] || null,
        novelAssistMode: true,
        novelAssistAction: action,
        novelContext: context,
        novelSelection: selection || "",
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { text: "", error: err.error || "API error " + res.status };
    }
    const data = await res.json();
    if (data.error) return { text: "", error: data.error };
    return { text: data.novelAssist || "" };
  } catch (err) {
    return { text: "", error: err.message || "Network error" };
  }
}