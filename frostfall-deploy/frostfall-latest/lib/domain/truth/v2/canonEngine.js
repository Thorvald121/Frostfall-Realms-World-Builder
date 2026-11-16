/**
 * Frostfall Truth Engine 2.0 — deterministic claim-level foundation.
 * Never infer physical participation or contemporaneity from prose mentions.
 * Facts have explicit scopes, time ranges, dispositions, and source IDs.
 * This module does NOT call AI or change canonical data.
 */
export const CANON_STATUSES = Object.freeze([
  "canon", "draft", "disputed", "superseded", "alternate",
]);

const time = (value) => value === undefined || value === null || value === "" ? null : Number(value);
const isYear = (v) => v !== null && Number.isFinite(v);
const branch = (item) => item.branchId || "main";
const scope = (item) => item.worldId || "default";
const isCanon = (a) => (a.status || "draft") === "canon";
const overlap = (a, b) => {
  const from = Math.max(a.from ?? -Infinity, b.from ?? -Infinity);
  const until = Math.min(a.until ?? Infinity, b.until ?? Infinity);
  return from <= until;
};
const sameScope = (a, b) => scope(a) === scope(b) && branch(a) === branch(b);
const finding = (code, severity, message, assertions, extra = {}) => ({
  id: [code, ...assertions.map((a) => a.id).sort()].join(":"),
  code, severity, message,
  assertionIds: assertions.map((a) => a.id),
  sourceIds: [...new Set(assertions.flatMap((a) => a.sourceIds || []))],
  ...extra,
});

/** Normalize only EXPLICIT facts. Textual @mentions are never assertions. */
export function normalizeAssertion(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.id || !raw.subjectId || !raw.predicate) return null;
  const from = time(raw.from);
  const until = time(raw.until);
  if ((from !== null && !isYear(from)) || (until !== null && !isYear(until))) return null;
  return {
    id: String(raw.id),
    worldId: String(raw.worldId || "default"),
    branchId: String(raw.branchId || "main"),
    subjectId: String(raw.subjectId), predicate: String(raw.predicate),
    objectId: raw.objectId == null ? null : String(raw.objectId),
    value: raw.value == null ? null : raw.value,
    from, until,
    status: CANON_STATUSES.includes(raw.status) ? raw.status : "draft",
    exclusive: raw.exclusive === true,
    sourceIds: Array.isArray(raw.sourceIds) ? raw.sourceIds.map(String) : [],
    notes: String(raw.notes || ""),
  };
}

/**
 * Compare explicit assertions only. Findings require a compatible world/branch.
 * Identity can be present before birth in remembered/prophetic lore; only
 * participated_in action assertions imply the entity physically acted.
 */
export function evaluateCanonAssertions(input) {
  const assertions = (Array.isArray(input) ? input : []).map(normalizeAssertion).filter(Boolean);
  const facts = assertions.filter(isCanon);
  const findings = [];
  const bySubject = new Map();
  for (const a of facts) {
    const key = [scope(a), branch(a), a.subjectId].join("|");
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(a);
    if (isYear(a.from) && isYear(a.until) && a.from > a.until) {
      findings.push(finding("invalid_interval", "error", "This fact ends before it begins.", [a]));
    }
  }
  for (const group of bySubject.values()) {
    const born = group.filter((a) => a.predicate === "born" && isYear(a.from));
    const died = group.filter((a) => a.predicate === "died" && isYear(a.from));
    for (const b of born) for (const d of died) {
      if (d.from < b.from) findings.push(finding("death_before_birth", "error", "Death precedes the recorded birth.", [b, d]));
    }
    for (const event of group.filter((a) => a.predicate === "participated_in" && isYear(a.from))) {
      for (const d of died) {
        if (event.from > d.from) {
          findings.push(finding("participation_after_death", "error", "Explicit participation occurs after the actor's recorded death.", [event, d]));
        } else if (isYear(event.until) && event.until > d.from) {
          findings.push(finding("participation_spans_death", "error", "Explicit participation continues beyond the actor's recorded death.", [event, d]));
        }
      }
      for (const b of born) {
        if (event.from < b.from) {
          findings.push(finding("participation_before_birth", "error", "Explicit participation occurs before the actor's recorded birth.", [event, b]));
        }
      }
    }
  }
  // Exclusivity is an authored rule, never inferred merely because two
  // kings, locations, or organizations share a name or territory.
  const exclusiveClaims = facts.filter((a) => a.exclusive && a.objectId && a.predicate);
  for (let i = 0; i < exclusiveClaims.length; i++) {
    for (let j = i + 1; j < exclusiveClaims.length; j++) {
      const a = exclusiveClaims[i], b = exclusiveClaims[j];
      if (!sameScope(a, b) || a.predicate !== b.predicate || a.objectId !== b.objectId) continue;
      if (!overlap(a, b)) continue;
      if (a.subjectId === b.subjectId) continue;
      findings.push(finding("exclusive_claim_overlap", "warning", `Two canon claims assert an exclusive ${a.predicate} over the same subject and interval.`, [a, b]));
    }
  }
  // Same entity simultaneously assigned two distinct EXPLICITLY-exclusive homes
  // or memberships. Never apply this rule to inferred relationships or reigns.
  const locationClaims = exclusiveClaims.filter((a) => a.predicate === "located_in" || a.predicate === "member_of");
  for (let i = 0; i < locationClaims.length; i++) {
    for (let j = i + 1; j < locationClaims.length; j++) {
      const a = locationClaims[i], b = locationClaims[j];
      if (!sameScope(a, b) || a.predicate !== b.predicate || a.subjectId !== b.subjectId) continue;
      if (a.objectId === b.objectId || !overlap(a, b)) continue;
      findings.push(finding("exclusive_subject_overlap", "warning", `One entity has two explicitly exclusive ${a.predicate} relationships during the same interval.`, [a, b]));
    }
  }
  for (const a of assertions) {
    if (!isCanon(a)) continue;
    if (!a.sourceIds.length) findings.push(finding("missing_provenance", "info", "Canon claim has no recorded source passage or author note.", [a]));
  }
  // Do not count the same finding multiple times.
  const stable = new Map(findings.map((f) => [f.id, f]));
  return { engine: "truth-v2", examined: assertions.length, canonical: facts.length,
    findings: [...stable.values()].sort((a, b) => a.id.localeCompare(b.id)), };
}

/** Safe bridge from the existing codex: only explicit typed temporal fields. */
export function explicitClaimsFromArticles(articles, worldId = "default") {
  const result = [];
  for (const a of (Array.isArray(articles) ? articles : [])) {
    if (!a?.id || a.category !== "character") continue;
    for (const [field, predicate] of [["birth_year", "born"], ["death_year", "died"]]) {
      const raw = a.temporal?.[field] ?? a.fields?.[field];
      if (raw === null || raw === undefined || raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      result.push({ id: `${a.id}:${predicate}`, worldId, branchId: "main",
        subjectId: a.id, predicate, from: n, until: n, status: "canon",
        sourceIds: a.sourceIds || [], notes: "Migrated from explicit codex temporal field" });
    }
  }
  return result;
}
