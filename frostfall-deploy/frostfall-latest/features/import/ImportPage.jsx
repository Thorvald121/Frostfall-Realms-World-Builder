"use client";

import React, { useState, useRef } from "react";
import * as mammoth from "mammoth";
import { CATEGORIES } from "@/lib/domain/categories";
import { parseDocument } from "@/lib/domain/documentParser";

/**
 * ImportPage — Two-tab document import: Manual (offline) + AI-powered.
 * Extracted from renderAIImport in FrostfallRealms.jsx.
 * Both tracks feed into the Staging Area for review before committing.
 */

const AI_PROVIDERS = {
  anthropic: { label: "Claude (Anthropic)", icon: "🟣", models: ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"] },
  openai: { label: "ChatGPT (OpenAI)", icon: "🟢", models: ["gpt-4o", "gpt-4o-mini"] },
  google: { label: "Gemini (Google)", icon: "🔵", models: ["gemini-2.0-flash", "gemini-2.5-pro-preview-05-06"] },
};

export function ImportPage({
  theme, settings, isMobile,
  // AI import state (from parent)
  aiParsing, aiParseError, setAiParseError, aiSourceName,
  aiProgress, aiFileRef, handleAiFileUpload,
  parseDocumentWithAI,
  // Staging
  setAiStaging, setView, setAiSourceName,
  // UI helpers
  ta, tBtnS, tBtnP, Ornament, WarningBanner, S,
}) {
  const [importTab, setImportTab] = useState("manual"); // "manual" | "ai"
  const manualFileRef = useRef(null);
  const [manualParsing, setManualParsing] = useState(false);
  const [manualResult, setManualResult] = useState(null); // { entries, warnings }
  const [manualError, setManualError] = useState(null);

  // --- Manual import handler ---
  const handleManualUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setManualError(null);
    setManualResult(null);
    setManualParsing(true);

    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "docx" || ext === "doc") {
      const reader = new FileReader();
      reader.onerror = () => { setManualError("Failed to read file."); setManualParsing(false); };
      reader.onload = async (ev) => {
        try {
          if (!mammoth || !mammoth.extractRawText) {
            setManualError("DOCX parser not loaded. Try a .txt or .md file instead.");
            setManualParsing(false);
            return;
          }
          const result = await mammoth.extractRawText({ arrayBuffer: ev.target.result });
          const text = result?.value;
          if (!text || text.length < 20) { setManualError("Document appears empty."); setManualParsing(false); return; }
          processManualText(text, file.name);
        } catch (err) {
          setManualError("Failed to read .docx: " + (err?.message || "Unknown error"));
          setManualParsing(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (ext === "pdf") {
      setManualError("PDF files are not supported. Please save as .txt or .md first.");
      setManualParsing(false);
    } else {
      const reader = new FileReader();
      reader.onerror = () => { setManualError("Failed to read file."); setManualParsing(false); };
      reader.onload = (ev) => {
        const text = ev.target.result;
        if (!text || text.length < 20) { setManualError("File appears empty."); setManualParsing(false); return; }
        processManualText(text, file.name);
      };
      reader.readAsText(file);
    }
    e.target.value = "";
  };

  const processManualText = (text, filename) => {
    try {
      const result = parseDocument(text, filename);
      setManualResult(result);
      if (result.entries.length > 0) {
        // Add entries to staging
        setAiStaging((prev) => [...prev, ...result.entries]);
        setAiSourceName(filename);
      }
    } catch (err) {
      setManualError("Parse error: " + (err?.message || "Unknown error"));
    }
    setManualParsing(false);
  };

  // Check API key status
  const activeProvider = settings.aiProvider || "anthropic";
  const userKey = settings.aiKeys?.[activeProvider];
  const hasUserKey = userKey && userKey.length > 10;

  const tabStyle = (active) => ({
    padding: "10px 24px", fontSize: 13, fontWeight: active ? 700 : 400,
    color: active ? theme.accent : theme.textDim,
    background: active ? ta(theme.accent, 0.08) : "transparent",
    border: "1px solid " + (active ? ta(theme.accent, 0.3) : "transparent"),
    borderBottom: active ? "2px solid " + theme.accent : "2px solid transparent",
    borderRadius: "8px 8px 0 0", cursor: "pointer", transition: "all 0.2s",
    fontFamily: "'Cinzel', serif", letterSpacing: 0.5,
  });

  return (
    <div>
      <div style={{ marginTop: 24, marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1, display: "flex", alignItems: "center", gap: 10 }}>
          📄 Document Import
        </h2>
        <p style={{ fontSize: 13, color: theme.textDim, marginTop: 6, lineHeight: 1.6 }}>
          Import lore documents into your codex. Use Manual Import for offline parsing, or AI Import for intelligent extraction.
        </p>
      </div>
      <Ornament width={300} />

      {/* Tab Toggle */}
      <div style={{ display: "flex", gap: 0, marginTop: 20, borderBottom: "1px solid " + theme.divider }}>
        <div onClick={() => setImportTab("manual")} style={tabStyle(importTab === "manual")}>
          📄 Manual Import
        </div>
        <div onClick={() => setImportTab("ai")} style={tabStyle(importTab === "ai")}>
          🧠 AI Import
        </div>
      </div>

      <div style={{ marginTop: 24, maxWidth: 680 }}>

        {/* ═══════ MANUAL IMPORT TAB ═══════ */}
        {importTab === "manual" && (
          <div>
            <p style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.7, marginBottom: 20 }}>
              Upload a structured document and we'll parse headings into codex entries. No API key needed — works completely offline.
            </p>

            {/* Drop zone */}
            <div onClick={() => manualFileRef.current?.click()} style={{
              border: "2px dashed " + ta(theme.accent, 0.3), borderRadius: 12, padding: "48px 32px", textAlign: "center",
              cursor: manualParsing ? "wait" : "pointer", transition: "all 0.3s",
              background: manualParsing ? ta(theme.accent, 0.04) : ta(theme.surface, 0.4),
            }}
              onMouseEnter={(e) => { if (!manualParsing) { e.currentTarget.style.border = "1px solid " + ta(theme.accent, 0.6); e.currentTarget.style.background = ta(theme.accent, 0.06); } }}
              onMouseLeave={(e) => { e.currentTarget.style.border = "1px solid " + ta(theme.accent, 0.3); e.currentTarget.style.background = manualParsing ? ta(theme.accent, 0.04) : ta(theme.surface, 0.4); }}>
              {manualParsing ? (
                <>
                  <div style={{ fontSize: 36, marginBottom: 12, animation: "pulse 1.5s ease-in-out infinite" }}>⚙</div>
                  <style>{`@keyframes pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }`}</style>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: theme.accent, margin: 0 }}>Parsing Document…</p>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: theme.text, margin: "0 0 6px" }}>Drop or Click to Upload</p>
                  <p style={{ fontSize: 12, color: theme.textDim }}>Supports .txt, .md, and .docx files. Use # Headings to separate entries.</p>
                </>
              )}
            </div>
            <input ref={manualFileRef} type="file" accept=".txt,.md,.docx" style={{ display: "none" }} onChange={handleManualUpload} />

            {manualError && <WarningBanner severity="error" icon="✕" title="Parse Error" style={{ marginTop: 16 }}>{manualError}</WarningBanner>}

            {/* Parse results */}
            {manualResult && (
              <div style={{ marginTop: 20, padding: "16px 20px", background: ta(theme.surface, 0.6), border: "1px solid " + theme.divider, borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: 20 }}>{manualResult.entries.length > 0 ? "✅" : "⚠"}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>
                      {manualResult.entries.length > 0
                        ? `Extracted ${manualResult.entries.length} entr${manualResult.entries.length === 1 ? "y" : "ies"}`
                        : "No entries extracted"
                      }
                    </div>
                    {manualResult.entries.length > 0 && (
                      <div style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>Sent to Staging Area for review</div>
                    )}
                  </div>
                  {manualResult.entries.length > 0 && (
                    <button onClick={() => setView("staging")} style={{ ...tBtnP, marginLeft: "auto", fontSize: 11, padding: "7px 16px" }}>
                      Review in Staging →
                    </button>
                  )}
                </div>

                {/* Entry preview list */}
                {manualResult.entries.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    {manualResult.entries.map((e) => (
                      <span key={e._stagingId} style={{
                        ...S.catBadge(CATEGORIES[e.category]?.color || "#888"),
                        fontSize: 10, padding: "3px 10px",
                      }}>
                        {CATEGORIES[e.category]?.icon} {e.title}
                        {e._confidence < 0.2 && <span style={{ marginLeft: 4, opacity: 0.6 }}>?</span>}
                      </span>
                    ))}
                  </div>
                )}

                {/* Warnings */}
                {manualResult.warnings.length > 0 && (
                  <div style={{ marginTop: 8, padding: "10px 14px", background: ta(theme.accent, 0.06), borderRadius: 6, border: "1px solid " + ta(theme.accent, 0.15) }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: theme.accent, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Parser Notes</div>
                    {manualResult.warnings.map((w, i) => (
                      <div key={i} style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.5, marginBottom: 3 }}>• {w}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* How It Works */}
            <div style={{ marginTop: 28 }}>
              <p style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: theme.text, marginBottom: 12, letterSpacing: 0.5 }}>◈ Formatting Guide</p>
              <div style={{ padding: "16px 20px", background: ta(theme.surface, 0.4), borderRadius: 8, border: "1px solid " + theme.border }}>
                <pre style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.7, margin: 0, fontFamily: "'Fira Code', monospace", whiteSpace: "pre-wrap" }}>{
`# Entry Title
Summary or description on the first line.

## Domain
God of Fire and Forge

## Worshippers
The smiths of Ironhold

Body text with lore details...
Tags: #deity #fire #forge

# Another Entry
Each top-level heading (#) becomes a separate
codex entry. Sub-headings (##) are mapped to
category-specific fields automatically.`
                }</pre>
              </div>
              <p style={{ fontSize: 11, color: theme.textDim, marginTop: 10, lineHeight: 1.6 }}>
                Categories are auto-detected from keywords. You can adjust them in the Staging Area before committing.
                Works with <strong style={{ color: theme.textMuted }}>**Bold Titles**</strong> and <span style={{ color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>ALL CAPS TITLES</span> as fallbacks if # headings aren't used.
              </p>
            </div>
          </div>
        )}

        {/* ═══════ AI IMPORT TAB ═══════ */}
        {importTab === "ai" && (
          <div>
            {/* API Key Status */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, padding: "10px 16px", borderRadius: 8, background: hasUserKey ? "rgba(142,200,160,0.06)" : "rgba(224,112,80,0.06)", border: "1px solid " + (hasUserKey ? "rgba(142,200,160,0.2)" : "rgba(224,112,80,0.2)") }}>
              <span style={{ fontSize: 14 }}>{hasUserKey ? "✅" : "⚠"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: hasUserKey ? "#8ec8a0" : "#e07050" }}>
                  {hasUserKey
                    ? `Using your ${AI_PROVIDERS[activeProvider]?.label} key`
                    : "No API key configured"
                  }
                </div>
                {!hasUserKey && (
                  <div style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>
                    Add an API key in <span style={{ color: theme.accent, cursor: "pointer", textDecoration: "underline" }} onClick={() => setView("settings")}>Settings → API Keys</span> to enable AI import, or use Manual Import instead.
                  </div>
                )}
              </div>
              {hasUserKey && (
                <span style={{ fontSize: 10, color: theme.textDim, padding: "3px 8px", background: ta(theme.surface, 0.5), borderRadius: 4 }}>
                  {AI_PROVIDERS[activeProvider]?.icon} {AI_PROVIDERS[activeProvider]?.label}
                </span>
              )}
            </div>

            <p style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.7, marginBottom: 20 }}>
              Upload a lore document and AI will parse it into structured codex entries with intelligent field mapping, cross-references, and temporal data.
            </p>

            {/* Drop zone */}
            <div onClick={() => { if (hasUserKey) aiFileRef.current?.click(); }} style={{
              border: "2px dashed " + (hasUserKey ? ta(theme.accent, 0.3) : ta(theme.textDim, 0.2)),
              borderRadius: 12, padding: "48px 32px", textAlign: "center",
              cursor: !hasUserKey ? "not-allowed" : aiParsing ? "wait" : "pointer",
              transition: "all 0.3s", opacity: hasUserKey ? 1 : 0.6,
              background: aiParsing ? ta(theme.accent, 0.04) : ta(theme.surface, 0.4),
            }}
              onMouseEnter={(e) => { if (!aiParsing && hasUserKey) { e.currentTarget.style.border = "1px solid " + ta(theme.accent, 0.6); e.currentTarget.style.background = ta(theme.accent, 0.06); } }}
              onMouseLeave={(e) => { e.currentTarget.style.border = "1px solid " + hasUserKey ? ta(theme.accent, 0.3) : ta(theme.textDim, 0.2); e.currentTarget.style.background = aiParsing ? ta(theme.accent, 0.04) : ta(theme.surface, 0.4); }}>
              {aiParsing ? (
                <>
                  <div style={{ fontSize: 36, marginBottom: 12, animation: "pulse 1.5s ease-in-out infinite" }}>🧠</div>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: theme.accent, margin: "0 0 6px" }}>Analyzing Document…</p>
                  <p style={{ fontSize: 12, color: theme.textDim, marginBottom: 10 }}>AI is reading "{aiSourceName}" and extracting lore entries</p>
                  {aiProgress.total > 0 && (
                    <div style={{ width: "80%", maxWidth: 300, margin: "0 auto" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: theme.textDim, marginBottom: 4 }}>
                        <span>Chunk {aiProgress.current} of {aiProgress.total}</span>
                        <span>{aiProgress.entries} entries found</span>
                      </div>
                      <div style={{ height: 6, background: theme.divider, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", background: "linear-gradient(90deg, #f0c040, #d4a020)", borderRadius: 3, width: (aiProgress.current / aiProgress.total * 100) + "%", transition: "width 0.5s ease" }} />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>{hasUserKey ? "🧠" : "🔒"}</div>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: theme.text, margin: "0 0 6px" }}>
                    {hasUserKey ? "Drop or Click to Upload" : "API Key Required"}
                  </p>
                  <p style={{ fontSize: 12, color: theme.textDim }}>
                    {hasUserKey
                      ? "Supports .txt, .md, and .docx files with lore, worldbuilding notes, bestiary entries, etc."
                      : "Configure an API key in Settings → API Keys to unlock AI-powered import."
                    }
                  </p>
                </>
              )}
            </div>

            {aiParseError && <WarningBanner severity="error" icon="✕" title="Parse Error" style={{ marginTop: 16 }}>{aiParseError}</WarningBanner>}

            {/* How It Works */}
            <div style={{ marginTop: 28 }}>
              <p style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: theme.text, marginBottom: 12, letterSpacing: 0.5 }}>◈ How AI Import Works</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { step: "1", title: "Upload", desc: "Upload a .txt, .md, or .docx document containing your lore, canon data, language specs, creature descriptions, or cultural notes." },
                  { step: "2", title: "AI Parsing", desc: `${AI_PROVIDERS[activeProvider]?.label || "AI"} reads your document and extracts structured entries, mapping each to the right category with filled template fields.` },
                  { step: "3", title: "Review", desc: "Parsed entries appear in the Staging Area. Review each one — approve, edit, or reject before committing to the codex." },
                  { step: "4", title: "Commit", desc: "Approved entries are added to your codex with full cross-referencing, temporal data, and integrity checking." },
                ].map((s) => (
                  <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: ta(theme.accent, 0.12), border: "1px solid " + ta(theme.accent, 0.3), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: theme.accent, flexShrink: 0 }}>{s.step}</div>
                    <div><div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{s.title}</div><div style={{ fontSize: 12, color: theme.textDim, marginTop: 2, lineHeight: 1.5 }}>{s.desc}</div></div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 28, padding: "16px 20px", background: "rgba(126,200,227,0.06)", border: "1px solid rgba(126,200,227,0.15)", borderRadius: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "#7ec8e3", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 1 }}>Supported Categories</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(CATEGORIES).map(([k, c]) => (
                  <span key={k} style={S.catBadge(c.color)}>{c.icon} {c.label}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ImportPage;