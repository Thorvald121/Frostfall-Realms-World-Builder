"use client";

export function IntegrityPanel({
  theme,
  visibleConflicts,
  globalIntegrity,
  totalIntegrityIssues,
  integrityVisible,
  INTEGRITY_PAGE,
  setIntegrityVisible,
  setDismissedConflicts,
  navigate,
  goEdit,
  Ornament,
  S,
  ta,
  CATEGORIES,
  tBtnS,
}) {
  const sevIcon = (sev) => (sev === "error" ? "🔴" : sev === "warning" ? "🟡" : "🔵");
  const sevColor = (sev) => (sev === "error" ? "#e07050" : sev === "warning" ? theme.accent : "#7ec8e3");

  return (
    <div>
      <div style={{ marginTop: 24, marginBottom: 20 }}>
        <h2
          style={{
            fontFamily: "'Cinzel', serif",
            fontSize: 22,
            color: "#e07050",
            margin: 0,
            letterSpacing: 1,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          🛡 Lore Integrity Report
        </h2>
        <p style={{ fontSize: 13, color: theme.textDim, marginTop: 6 }}>
          Full integrity scan across the codex — temporal conflicts, broken references,
          contradictions, and missing data.
        </p>
      </div>

      <Ornament width={300} />

      {totalIntegrityIssues === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "#8ec8a0" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <p style={{ fontSize: 16, fontFamily: "'Cinzel', serif" }}>No Canon Conflicts Detected</p>
          <p style={{ fontSize: 12, color: theme.textDim }}>All articles passed integrity checks.</p>
        </div>
      ) : (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
            {[
              {
                n:
                  visibleConflicts.filter((c) => c.severity === "error").length +
                  globalIntegrity.reduce(
                    (t, a) => t + a.issues.filter((w) => w.severity === "error").length,
                    0
                  ),
                l: "Errors",
                c: "#e07050",
              },
              {
                n:
                  visibleConflicts.filter((c) => c.severity === "warning").length +
                  globalIntegrity.reduce(
                    (t, a) => t + a.issues.filter((w) => w.severity === "warning").length,
                    0
                  ),
                l: "Warnings",
                c: theme.accent,
              },
              {
                n: new Set([
                  ...visibleConflicts.map((c) => c.sourceId),
                  ...globalIntegrity.map((a) => a.article.id),
                ]).size,
                l: "Articles Affected",
                c: "#7ec8e3",
              },
            ].map((s, i) => (
              <div key={i} style={{ ...S.statCard, flex: "0 0 auto", padding: "14px 24px" }}>
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 2,
                    background: s.c,
                  }}
                />
                <p
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: s.c,
                    fontFamily: "'Cinzel', serif",
                    margin: 0,
                  }}
                >
                  {s.n}
                </p>
                <p
                  style={{
                    fontSize: 10,
                    color: theme.textDim,
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                    marginTop: 4,
                  }}
                >
                  {s.l}
                </p>
              </div>
            ))}
          </div>

          {/* Cross-article temporal conflicts */}
          {visibleConflicts.length > 0 && (
            <>
              <h3
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: 14,
                  color: theme.text,
                  margin: "24px 0 12px",
                  letterSpacing: 1,
                }}
              >
                ⏱ Temporal Conflicts
              </h3>
              {visibleConflicts.map((c) => (
                <div
                  key={c.id}
                  style={{
                    background: ta(theme.surface, 0.5),
                    border:
                      "1px solid " +
                      (c.severity === "error"
                        ? "rgba(224,112,80,0.25)"
                        : ta(theme.accent, 0.2)),
                    borderLeft:
                      "3px solid " + (c.severity === "error" ? "#e07050" : theme.accent),
                    borderRadius: 6,
                    padding: "16px 20px",
                    marginBottom: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <span
                      style={{
                        fontSize: 18,
                        color: c.severity === "error" ? "#e07050" : theme.accent,
                      }}
                    >
                      {c.severity === "error" ? "✕" : "⚠"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <span style={S.catBadge(c.severity === "error" ? "#e07050" : theme.accent)}>
                        {c.severity} · Temporal Conflict
                      </span>
                      <p style={{ fontSize: 13, color: theme.text, margin: "8px 0", lineHeight: 1.6 }}>
                        {c.message}
                      </p>
                      <p style={{ fontSize: 12, color: theme.textMuted, margin: 0, fontStyle: "italic" }}>
                        💡 {c.suggestion}
                      </p>
                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontSize: 11,
                            color: "#7ec8e3",
                            cursor: "pointer",
                            padding: "4px 12px",
                            background: "rgba(126,200,227,0.1)",
                            borderRadius: 12,
                          }}
                          onClick={() => navigate(c.sourceId)}
                        >
                          View "{c.sourceTitle}" →
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: theme.accent,
                            cursor: "pointer",
                            padding: "4px 12px",
                            background: ta(theme.accent, 0.1),
                            borderRadius: 12,
                          }}
                          onClick={() => navigate(c.targetId)}
                        >
                          View "{c.targetTitle}" →
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: theme.textDim,
                            cursor: "pointer",
                            padding: "4px 12px",
                            background: "rgba(85,102,119,0.1)",
                            borderRadius: 12,
                          }}
                          onClick={() => setDismissedConflicts((p) => new Set([...p, c.id]))}
                        >
                          Dismiss
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Per-article integrity issues */}
          {globalIntegrity.length > 0 && (
            <>
              <h3
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: 14,
                  color: theme.text,
                  margin: "24px 0 12px",
                  letterSpacing: 1,
                }}
              >
                📋 Article Integrity Issues{" "}
                <span style={{ fontWeight: 400, fontSize: 11, color: theme.textDim }}>
                  ({globalIntegrity.length} articles
                  {globalIntegrity.length > integrityVisible ? " · showing " + integrityVisible : ""})
                </span>
              </h3>

              {globalIntegrity.slice(0, integrityVisible).map(({ article: a, issues }) => (
                <div
                  key={a.id}
                  style={{
                    background: ta(theme.surface, 0.5),
                    border: "1px solid rgba(224,112,80,0.15)",
                    borderRadius: 8,
                    padding: "14px 18px",
                    marginBottom: 8,
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  onClick={() => navigate(a.id)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = ta(theme.surface, 0.85);
                    e.currentTarget.style.border = "1px solid " + "rgba(224,112,80,0.35)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = ta(theme.surface, 0.5);
                    e.currentTarget.style.border = "1px solid " + "rgba(224,112,80,0.15)";
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ color: CATEGORIES[a.category]?.color }}>{CATEGORIES[a.category]?.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{a.title}</span>
                    <span style={S.catBadge(CATEGORIES[a.category]?.color)}>{CATEGORIES[a.category]?.label}</span>
                    <span style={{ ...S.catBadge("#e07050"), marginLeft: "auto" }}>
                      {issues.length} issue{issues.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {issues.map((w, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: 8,
                        padding: "7px 0 7px 28px",
                        fontSize: 12,
                        alignItems: "flex-start",
                      }}
                    >
                      <span style={{ marginTop: 1, color: sevColor(w.severity) }}>{sevIcon(w.severity)}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: theme.textMuted, lineHeight: 1.55 }}>{w.message}</div>

                        {w.suggestion && (
                          <div
                            style={{
                              marginTop: 6,
                              color: theme.textDim,
                              fontStyle: "italic",
                              fontSize: 11,
                              lineHeight: 1.5,
                            }}
                          >
                            💡 {w.suggestion}
                          </div>
                        )}

                        {/* Broken ref: show top fuzzy matches as quick navigation */}
                        {w.type === "broken_ref" && Array.isArray(w.fuzzyMatches) && w.fuzzyMatches.length > 0 && (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                            {w.fuzzyMatches.slice(0, 3).map((m, idx) => (
                              <span
                                key={idx}
                                style={{
                                  fontSize: 11,
                                  color: "#7ec8e3",
                                  cursor: "pointer",
                                  padding: "4px 10px",
                                  background: "rgba(126,200,227,0.10)",
                                  borderRadius: 12,
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(m.article?.id);
                                }}
                                title={`Open ${m.article?.title || m.article?.id}`}
                              >
                                {m.article?.title || m.article?.id} →
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#7ec8e3",
                        cursor: "pointer",
                        padding: "3px 10px",
                        background: "rgba(126,200,227,0.08)",
                        borderRadius: 12,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(a.id);
                      }}
                    >
                      View article →
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: theme.accent,
                        cursor: "pointer",
                        padding: "3px 10px",
                        background: ta(theme.accent, 0.08),
                        borderRadius: 12,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        goEdit(a);
                      }}
                    >
                      Edit article →
                    </span>
                  </div>
                </div>
              ))}

              {globalIntegrity.length > integrityVisible && (
                <div style={{ textAlign: "center", padding: "12px 0" }}>
                  <button
                    onClick={() => setIntegrityVisible((v) => v + INTEGRITY_PAGE)}
                    style={{ ...tBtnS, padding: "8px 24px", fontSize: 11, borderRadius: 8 }}
                  >
                    Show more ({globalIntegrity.length - integrityVisible} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}