/**
 * Frostfall Codex spelling engine — local and deterministic.
 * Uses the same offline English headword source as Sagnverk, loaded only when
 * the editor opens. No document text or account vocabulary goes to an API.
 * This is a conservative spelling pass, not an AI grammar checker.
 */
export const CODEX_SPELL_LIMIT = 120;
export const CODEX_TEXT_LIMIT = 70000;

const COMMON_CORRECTIONS = Object.freeze({
  teh: "the", hte: "the", adn: "and", becuase: "because", recieve: "receive",
  recieving: "receiving", wierd: "weird", seperate: "separate",
  definately: "definitely", occured: "occurred", thier: "their",
  woudl: "would", shoudl: "should", couldnt: "couldn't",
  dont: "don't", doesnt: "doesn't", didnt: "didn't",
  cant: "can't", isnt: "isn't", wasnt: "wasn't",
  alot: "a lot", untill: "until", acheive: "achieve",
  suprise: "surprise", tommorow: "tomorrow", neccessary: "necessary",
  wth: "with", wht: "what", wrking: "working", wirking: "working",
  wrok: "work", acutally: "actually", accomodate: "accommodate",
  alwasy: "always", freind: "friend", enviroment: "environment",
  thsi: "this", waht: "what", throught: "through", beleive: "believe",
});
const ORDINARY_CONTRACTIONS = new Set([
  "i'm", "i've", "i'll", "i'd", "you're", "you've", "you'll", "you'd",
  "we're", "we've", "we'll", "we'd", "they're", "they've", "they'll", "they'd",
  "he's", "he'll", "he'd", "she's", "she'll", "she'd", "it's", "it'll",
  "that's", "there's", "what's", "who's", "where's", "let's", "o'clock",
  "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
  "can't", "won't", "wouldn't", "couldn't", "shouldn't", "haven't",
  "hasn't", "hadn't", "mustn't", "needn't", "ain't",
]);

const WORD_PATTERN = /[\p{L}]+(?:[’'-][\p{L}]+)*/gu;
const SKIP_PARENT = "pre,code,a,kbd,samp,[contenteditable='false'],[data-mention-id]";

export function normalizeCodexWord(input) {
  return String(input ?? "").normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").replace(/[’]/g, "'");
}

function commonWordForms(word, has) {
  if (word.endsWith("'s") && has(word.slice(0, -2))) return true;
  if (word.endsWith("s'") && has(word.slice(0, -1))) return true;
  const suffixes = ["ings", "ing", "edly", "ed", "ies", "es", "s", "ly", "ness", "less", "ful", "er", "est"];
  for (const suffix of suffixes) {
    if (!word.endsWith(suffix) || word.length <= suffix.length + 3) continue;
    const stem = word.slice(0, -suffix.length);
    if (has(stem)) return true;
    if (suffix === "ies" && has(stem + "y")) return true;
    if (["ing", "ings", "ed"].includes(suffix)) {
      if (has(stem + "e")) return true;
      if (stem.length > 3 && stem.at(-1) === stem.at(-2) && has(stem.slice(0, -1))) return true;
    }
  }
  return false;
}
function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous2 = null;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let minimum = i;
    for (let j = 1; j <= b.length; j++) {
      let cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let score = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && previous2 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        score = Math.min(score, previous2[j - 2] + 1);
      current[j] = score;
      minimum = Math.min(minimum, score);
    }
    if (minimum > cap) return cap + 1;
    previous2 = previous;
    previous = current;
  }
  return previous[b.length];
}
function matchCase(original, word) {
  return /^[A-Z]/.test(original) ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

export function createCodexSpellingEngine(headwords = [], frequencyWords = []) {
  const words = new Set(headwords.map(normalizeCodexWord).filter(Boolean));
  const frequencyRank = new Map();
  frequencyWords.forEach((word, i) => {
    const normalized = normalizeCodexWord(word);
    if (normalized && !frequencyRank.has(normalized)) frequencyRank.set(normalized, i);
  });
  const frequencyPenalty = word => {
    const rank = frequencyRank.get(word);
    // The English lexicon contains many rare words and names. Rank actual
    // prose words first when typing distance is similar.
    if (rank === undefined) return 105;
    if (rank < 200) return 0;
    if (rank < 1000) return 16;
    if (rank < 3000) return 32;
    if (rank < 7000) return 53;
    return 75;
  };
  const splitCandidate = word => {
    if (word.length < 6 || word.length > 30) return null;
    let best = null;
    for (let i = 2; i <= word.length - 3; i++) {
      const left = word.slice(0, i), right = word.slice(i);
      const leftRank = frequencyRank.get(left), rightRank = frequencyRank.get(right);
      if (leftRank === undefined || rightRank === undefined ||
          leftRank > 3000 || rightRank > 3000 || !words.has(left) || !words.has(right)) continue;
      const score = leftRank + rightRank + Math.abs(i - (word.length-i))*10;
      if (!best || score < best.score) best = { text: left + " " + right, score };
    }
    return best?.text || null;
  };
  const byPrefix = new Map();
  const byLength = new Map();
  for (const word of words) {
    const prefix = word.slice(0, 2);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(word);
    if (!byLength.has(word.length)) byLength.set(word.length, []);
    byLength.get(word.length).push(word);
  }
  const suggestionCache = new Map();
  function correct(raw, approved = null) {
    const w = normalizeCodexWord(raw);
    if (!w || w.length < 2) return true;
    const has = (value) => words.has(value) || !!approved?.has(value);
    if (has(w) || ORDINARY_CONTRACTIONS.has(w) || commonWordForms(w, has)) return true;
    if (w.includes("-")) return w.split("-").every(part => part && (has(part) || commonWordForms(part, has)));
    return false;
  }
  function suggest(raw) {
    const target = normalizeCodexWord(raw);
    if (!target || correct(raw)) return [];
    if (suggestionCache.has(target)) return suggestionCache.get(target).map(x => matchCase(raw, x));
    const candidateSet = new Set();
    const prefix = target.slice(0, 2);
    // All words sharing the opening pair; include one-character first-letter
    // swaps and short typo variants. This remains bounded to the lazy index.
    const prefixGroups = [prefix, target[1] + target[0], target.slice(1, 3)];
    for (const key of prefixGroups) {
      for (const word of byPrefix.get(key) || []) {
        if (Math.abs(word.length - target.length) <= 2) candidateSet.add(word);
      }
    }
    if (candidateSet.size < 30) {
      for (let length = Math.max(2, target.length - 2); length <= target.length + 2; length++) {
        for (const word of byLength.get(length) || []) {
          if (word[0] === target[0] || word.at(-1) === target.at(-1)
            || word.slice(1, 3) === target.slice(1, 3)) candidateSet.add(word);
        }
      }
    }
    const maxDistance = target.length <= 4 ? 2 : target.length <= 8 ? 2 : 3;
    const ranked = [...candidateSet]
      .filter(w => w !== target && !w.includes("'") && !w.includes("-"))
      .map(word => ({word, distance: editDistance(target, word, maxDistance)}))
      .filter(x => x.distance > 0 && x.distance <= maxDistance)
      .map(x => ({...x, score: x.distance * 80 + frequencyPenalty(x.word)
        + (x.word.startsWith(target.slice(0, 2)) ? -8 : 0)
        + (x.word[0] === target[0] ? -5 : 0)}))
      .sort((a, b) => a.score-b.score || a.distance-b.distance || a.word.localeCompare(b.word))
      .slice(0, 5).map(x=>x.word);
    // When two ordinary words were joined, propose a real space instead of
    // unrelated edit-distance guesses. Both halves must be common English.
    const split = splitCandidate(target);
    if (split) ranked.unshift(split);
    const common = COMMON_CORRECTIONS[target];
    if (common) ranked.unshift(common);
    const found = [...new Set(ranked)].slice(0, 5);
    if (suggestionCache.size > 1200) suggestionCache.clear();
    suggestionCache.set(target, found);
    return found.map(x => matchCase(raw, x));
  }
  return { correct, suggest, size: words.size };
}

let sharedEngine;
export function loadCodexSpellingEngine() {
  if (!sharedEngine) {
    sharedEngine = Promise.all([import("./codexEnglishWords.json"), import("./codexEnglishFrequency.json")])
      .then(([dict, frequency]) => createCodexSpellingEngine(
        (dict.default || dict).words,
        (frequency.default || frequency).words,
      ))
      .catch(error => { sharedEngine = null; throw error; });
  }
  return sharedEngine;
}

/**
 * Find probable misspellings in one DOM text node. Never touch HTML strings;
 * only report exact word ranges. Proper fantasy names are skipped by default.
 */
export function analyzeCodexText(text, engine, options = {}) {
  if (typeof text !== "string" || !engine) return [];
  const approved = options.approved || new Set();
  const ignored = options.ignored || new Set();
  const checkNames = options.checkNames === true;
  const issues = [];
  const pattern = new RegExp(WORD_PATTERN.source, WORD_PATTERN.flags);
  for (const match of text.matchAll(pattern)) {
    const word = match[0];
    const normalized = normalizeCodexWord(word);
    if (word.length < 3 || word.length > 35 || ignored.has(normalized) || approved.has(normalized)) continue;
    if (/^[A-Z]{2,}$/.test(word) || /[a-z][A-Z]/.test(word)) continue;
    if (!checkNames && /^[A-Z][a-z]/.test(word)) continue;
    if (engine.correct(word, approved)) continue;
    // Skip email/URL fragments and identifiers; fantasy prose is not a code linter.
    const around = text.slice(Math.max(0, match.index - 14), match.index + word.length + 14);
    if (/https?:|www\.|@[\w.-]+\.[a-z]{2,}/i.test(around)) continue;
    const suggestions = engine.suggest(word);
    issues.push({ word, start: match.index, end: match.index + word.length, suggestions });
    if (issues.length >= (options.limit || CODEX_SPELL_LIMIT)) break;
  }
  return issues;
}
export function collectCodexSpellingIssues(root, engine, options = {}) {
  if (!root || !engine) return [];
  const win = root.ownerDocument?.defaultView;
  if (!win) return [];
  const walker = root.ownerDocument.createTreeWalker(root, win.NodeFilter.SHOW_TEXT);
  const result = [];
  let node;
  let characters = 0;
  while ((node = walker.nextNode()) && result.length < CODEX_SPELL_LIMIT) {
    if (node.parentElement?.closest(SKIP_PARENT)) continue;
    characters += node.data.length;
    if (characters > CODEX_TEXT_LIMIT) break;
    const hits = analyzeCodexText(node.data, engine, { ...options, limit: CODEX_SPELL_LIMIT - result.length });
    for (const hit of hits) result.push({ ...hit, node, id: result.length + ":" + hit.start + ":" + hit.word });
  }
  return result;
}
/** Apply one exact replacement to the source Text node, preserving all ancestor formatting. */
export function replaceCodexSpellingIssue(root, issue, replacement) {
  if (!root || !issue?.node || issue.node.nodeType !== 3 || !root.contains(issue.node)) return false;
  if (typeof replacement !== "string" || replacement.length > 80 ||
    !/^[\p{L}][\p{L}'’ -]*$/u.test(replacement)) return false;
  const { node, start, end, word } = issue;
  if (!Number.isInteger(start) || !Number.isInteger(end) || node.data.slice(start, end) !== word) return false;
  node.replaceData(start, end - start, replacement);
  return true;
}
export function codexWordStorageKey(userId, worldId) {
  if (!userId || !worldId) return null;
  return "fr:codex:spelling:v1:" + encodeURIComponent(userId) + ":" + encodeURIComponent(worldId);
}
export function readCodexWordList(storage, key) {
  if (!storage || !key) return new Set();
  try {
    const saved = JSON.parse(storage.getItem(key) || "[]");
    return new Set((Array.isArray(saved) ? saved : []).slice(0, 3000).map(normalizeCodexWord).filter(Boolean));
  } catch { return new Set(); }
}
export function saveCodexWordList(storage, key, words) {
  if (!storage || !key) return false;
  try {
    storage.setItem(key, JSON.stringify([...words].slice(0, 3000)));
    return true;
  } catch { return false; }
}
