"use client";

import React, { useState, useCallback, useMemo } from "react";
import { CATEGORIES, formatKey } from "@/lib/domain/categories";
import { EDITOR_FONTS } from "@/lib/domain/categories";
import { checkWord, aiProofread, aiNovelAssist, SUGGESTION_STYLES } from "@/lib/domain/writingTools";

/**
 * NovelWorkspace — Full novel writing tool with manuscript management,
 * act/chapter/scene structure, contentEditable editor, corkboard view,
 * focus mode, split pane, mentions, snapshots, compile/export, and goals.
 *
 * Extracted from FrostfallRealms.jsx renderNovel (~795 lines).
 * All state is owned by the parent; this component receives props.
 */
export function NovelWorkspace({
  // Core
  theme, articles, settings, setSettings, isMobile, isTablet, activeWorld,
  // Navigation
  navigate, goEdit, setView, setActiveArticle,
  // Novel state
  view, novelView, setNovelView, novelFocusMode, setNovelFocusMode,
  novelSplitPane, setNovelSplitPane, novelActiveScene, setNovelActiveScene,
  novelSplitSceneId, setNovelSplitSceneId,
  novelCodexSearch, setNovelCodexSearch, novelCodexFilter, setNovelCodexFilter,
  novelCodexExpanded, setNovelCodexExpanded, novelCodexVisible, setNovelCodexVisible,
  novelMention, setNovelMention, novelOutlineCollapsed, setNovelOutlineCollapsed,
  novelMsForm, setNovelMsForm, novelEditorSettings, setNovelEditorSettings,
  novelExportOpen, setNovelExportOpen, novelGoal, setNovelGoal,
  novelExportSettings, setNovelExportSettings,
  novelGoalInput, setNovelGoalInput, novelShowGoalSet, setNovelShowGoalSet,
  novelSnapshotView, setNovelSnapshotView, novelCompiling,
  corkboardChapter, setCorkboardChapter, corkboardDragId, setCorkboardDragId,
  mentionTooltip, setMentionTooltip, showMsCreate, setShowMsCreate,
  // Manuscript data
  manuscripts, setManuscripts, activeMs, setActiveMs,
  // Novel computations
  msWordCount, goalProgress, sessionWords, editorFontFamily, novelCodexArticles,
  // Novel helpers
  countWords, stripTags, chapterWordCount, getActiveScene,
  navigateScene, saveSnapshot, restoreSnapshot,
  createManuscript, deleteManuscript,
  addChapter, addScene, addAct, updateAct, updateChapter, updateScene,
  deleteAct, deleteChapter, deleteScene,
  compileManuscript, handleCorkDrop, handleEditorClick,
  reorderActs, reorderChapters, reorderScenes,
  handleNovelInput, handleMentionKeyDown, handleEditorMouseOver,
  insertMention, insertMentionFromSidebar,
  execFormat, updateFormatState, formatState,
  checkSceneIntegrity,
  // Refs
  novelEditorRef, isComposingRef,
  // UI helpers
  ta, tBtnS, tBtnP, tTag, Ornament, WarningBanner, RenderBody, S,
  lower, formatYear, timeAgo,
}) {
  const NOVEL_CODEX_PAGE = 25;
  const STATUS_COLORS = { draft: theme.textDim, revised: theme.accent, final: "#8ec8a0" };
  const SCENE_STATUSES = [
    { id: "draft", label: "Draft", color: theme.textDim, icon: "✎" },
    { id: "revised", label: "Revised", color: "#7ec8e3", icon: "✓" },
    { id: "final", label: "Final", color: "#8ec8a0", icon: "★" },
    { id: "needs_work", label: "Needs Work", color: "#e07050", icon: "⚠" },
  ];
  const SCENE_COLORS = [
    { id: "none", color: "transparent", label: "None" },
    { id: "red", color: "#e07050", label: "Action" },
    { id: "blue", color: "#7ec8e3", label: "World Building" },
    { id: "green", color: "#8ec8a0", label: "Character Dev" },
    { id: "gold", color: theme.accent, label: "Plot Point" },
    { id: "purple", color: "#c084fc", label: "Dialogue" },
    { id: "pink", color: "#f472b6", label: "Romance" },
    { id: "teal", color: "#5eead4", label: "Mystery" },
  ];

  // ─── Writing Tools State ───
  const [proofSuggestions, setProofSuggestions] = useState([]);
  const [proofLoading, setProofLoading] = useState(false);
  const [proofError, setProofError] = useState(null);
  const [proofPanelOpen, setProofPanelOpen] = useState(false);

  // ─── AI Writing Assistant State ───
  const [aiAssistLoading, setAiAssistLoading] = useState(false);
  const [aiAssistResult, setAiAssistResult] = useState(null); // { text, action }
  const [aiAssistError, setAiAssistError] = useState(null);
  const [aiAssistMenuOpen, setAiAssistMenuOpen] = useState(false);

  // ─── Outline Drag State ───
  const [outlineDrag, setOutlineDrag] = useState(null); // { type: 'act'|'chapter'|'scene', id, actId?, chId?, idx }
  const [outlineDragOver, setOutlineDragOver] = useState(null); // target id for visual indicator

  // ─── Export Settings Panel ───
  const [exportSettingsOpen, setExportSettingsOpen] = useState(false);

  const hasApiKey = !!settings.aiKeys?.[settings.aiProvider || "anthropic"];

  const getSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    return sel.toString().trim() || null;
  };

  const buildNovelContext = () => {
    const scene = getActiveScene();
    if (!scene) return {};
    const ms = activeMs || manuscripts?.[0];
    let actTitle = "", chapterTitle = "";
    if (ms) {
      for (const a of (ms.acts || [])) {
        for (const c of (a.chapters || [])) {
          if (c.scenes?.find((s) => s.id === scene.id)) {
            actTitle = a.title; chapterTitle = c.title; break;
          }
        }
        if (actTitle) break;
      }
    }
    // Build codex context from @mentions in the scene
    const mentionIds = (scene.body || "").match(/@\[([^\]]+)\]\(([^)]+)\)/g)?.map((m) => {
      const match = m.match(/@\[([^\]]+)\]\(([^)]+)\)/);
      return match ? match[2] : null;
    }).filter(Boolean) || [];
    const codexEntries = mentionIds.map((id) => articles.find((a) => a.id === id)).filter(Boolean);
    const codexContext = codexEntries.length > 0
      ? codexEntries.map((a) => `${a.title} (${a.category}): ${a.summary || ""}${a.fields?.char_race ? " — Race: " + a.fields.char_race : ""}${a.fields?.role ? " — Role: " + a.fields.role : ""}`).join("\n")
      : "";
    // Strip HTML for plain text
    const div = document.createElement("div"); div.innerHTML = scene.body || ""; const plainText = div.textContent || "";
    return {
      worldName: activeWorld?.name || "",
      actTitle, chapterTitle,
      sceneTitle: scene.title || "",
      sceneText: plainText,
      codexContext,
    };
  };

  const runAiAssist = useCallback(async (action) => {
    const scene = getActiveScene();
    if (!scene) return;
    setAiAssistLoading(true); setAiAssistError(null); setAiAssistResult(null); setAiAssistMenuOpen(false);
    const selection = (action !== "continue" && action !== "describe") ? getSelection() : null;
    if ((action === "rewrite" || action === "expand" || action === "dialogue") && !selection) {
      setAiAssistError(`Select some text first for "${action}"`);
      setAiAssistLoading(false); return;
    }
    const context = buildNovelContext();
    const { text, error } = await aiNovelAssist(action, context, selection, settings);
    if (error) { setAiAssistError(error); setAiAssistLoading(false); return; }
    setAiAssistResult({ text, action, selection }); setAiAssistLoading(false);
  }, [getActiveScene, articles, settings, activeWorld, activeMs, manuscripts]);

  const acceptAiAssist = useCallback(() => {
    if (!aiAssistResult?.text) return;
    const editor = novelEditorRef.current;
    if (!editor) return;
    const { action, text, selection } = aiAssistResult;
    if (action === "continue" || action === "describe") {
      // Append to end of editor
      editor.focus();
      const sel = window.getSelection();
      sel.selectAllChildren(editor);
      sel.collapseToEnd();
      document.execCommand("insertHTML", false, "<br>" + text.replace(/\n/g, "<br>"));
    } else if (selection) {
      // Try to find and replace the selection in the editor
      editor.focus();
      const currentSel = window.getSelection();
      // Use find to locate the selection text
      if (window.find && window.find(selection.slice(0, 100))) {
        document.execCommand("insertHTML", false, text.replace(/\n/g, "<br>"));
      } else {
        // Fallback: append at end
        currentSel.selectAllChildren(editor);
        currentSel.collapseToEnd();
        document.execCommand("insertHTML", false, "<br>" + text.replace(/\n/g, "<br>"));
      }
    }
    handleNovelInput();
    setAiAssistResult(null);
  }, [aiAssistResult, novelEditorRef, handleNovelInput]);

  const handleProofread = useCallback(async () => {
    const scene = getActiveScene();
    if (!scene?.body) return;
    setProofLoading(true); setProofError(null); setProofSuggestions([]);
    setProofPanelOpen(true);

    // Strip HTML to plain text for proofreading
    const div = document.createElement("div");
    div.innerHTML = scene.body;
    const plainText = div.textContent || div.innerText || "";

    const result = await aiProofread(plainText, settings);
    setProofSuggestions(result.suggestions || []);
    setProofError(result.error || null);
    setProofLoading(false);
  }, [getActiveScene, settings]);

  const applySuggestion = useCallback((suggestion, index) => {
    if (!novelEditorRef.current) return;
    const html = novelEditorRef.current.innerHTML;
    // Escape special regex characters in the original text
    const escaped = suggestion.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    if (regex.test(html)) {
      novelEditorRef.current.innerHTML = html.replace(regex, suggestion.suggestion);
      handleNovelInput(); // trigger save
    } else {
      // Try on text content
      const textContent = novelEditorRef.current.textContent || "";
      if (textContent.includes(suggestion.original)) {
        // Find and replace in text nodes
        const walker = document.createTreeWalker(novelEditorRef.current, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.textContent.includes(suggestion.original)) {
            node.textContent = node.textContent.replace(suggestion.original, suggestion.suggestion);
            handleNovelInput();
            break;
          }
        }
      }
    }
  }, [handleNovelInput, novelEditorRef]);

  // Autocorrect on space/enter (Layer 2)
  const handleAutoCorrectKeyDown = useCallback((e) => {
    if (!settings.autoCorrect) return;
    if (e.key !== " " && e.key !== "Enter") return;

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;

    const text = node.textContent;
    const offset = range.startOffset;
    // Find the last word before cursor
    const beforeCursor = text.slice(0, offset);
    const wordMatch = beforeCursor.match(/(\S+)$/);
    if (!wordMatch) return;

    const word = wordMatch[1];
    const correction = checkWord(word);
    if (correction && correction !== word) {
      const wordStart = offset - word.length;
      node.textContent = text.slice(0, wordStart) + correction + text.slice(offset);
      // Restore cursor position
      const newOffset = wordStart + correction.length;
      range.setStart(node, newOffset);
      range.setEnd(node, newOffset);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [settings.autoCorrect]);

  // ─── Scene Status Cycling ───
  const cycleStatus = useCallback((actId, chId, scId) => {
    const order = ["draft", "revised", "final", "needs_work"];
    const scene = (() => {
      const ms = activeMs || manuscripts?.[0];
      if (!ms) return null;
      for (const a of ms.acts) for (const c of a.chapters) for (const s of c.scenes) if (s.id === scId) return s;
      return null;
    })();
    const current = scene?.status || "draft";
    const next = order[(order.indexOf(current) + 1) % order.length];
    updateScene(actId, chId, scId, { status: next });
  }, [activeMs, manuscripts, updateScene]);

  // ─── Word Target Progress ───
  const sceneWordProgress = useCallback((scene) => {
    if (!scene?.wordTarget || scene.wordTarget <= 0) return null;
    const words = countWords(scene.body);
    return { words, target: scene.wordTarget, pct: Math.min(100, Math.round((words / scene.wordTarget) * 100)) };
  }, [countWords]);

  const chapterWordProgress = useCallback((ch) => {
    if (!ch?.wordTarget || ch.wordTarget <= 0) return null;
    const words = chapterWordCount(ch);
    return { words, target: ch.wordTarget, pct: Math.min(100, Math.round((words / ch.wordTarget) * 100)) };
  }, [chapterWordCount]);

  // ─── Outline Drag Handlers ───
  const handleOutlineDragStart = useCallback((type, id, actId, chId, idx) => {
    setOutlineDrag({ type, id, actId, chId, idx });
  }, []);
  const handleOutlineDragOver = useCallback((e, targetId) => {
    e.preventDefault();
    setOutlineDragOver(targetId);
  }, []);
  const handleOutlineDrop = useCallback((type, targetIdx, targetActId, targetChId) => {
    if (!outlineDrag || outlineDrag.type !== type) { setOutlineDrag(null); setOutlineDragOver(null); return; }
    if (type === "act") reorderActs(outlineDrag.idx, targetIdx);
    else if (type === "chapter" && outlineDrag.actId === targetActId) reorderChapters(targetActId, outlineDrag.idx, targetIdx);
    else if (type === "scene" && outlineDrag.actId === targetActId && outlineDrag.chId === targetChId) reorderScenes(targetActId, targetChId, outlineDrag.idx, targetIdx);
    setOutlineDrag(null);
    setOutlineDragOver(null);
  }, [outlineDrag, reorderActs, reorderChapters, reorderScenes]);

  // ─── Get all scenes flat for split pane picker ───
  const allScenes = useMemo(() => {
    if (!activeMs) return [];
    const result = [];
    for (const a of activeMs.acts) for (const c of a.chapters) for (const s of c.scenes) result.push({ ...s, actId: a.id, actTitle: a.title, chId: c.id, chTitle: c.title });
    return result;
  }, [activeMs]);

  return (
    <div style={{ margin: "0 -28px", height: "calc(100vh - 56px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Manuscript Selector */}
      {novelView === "select" && (
        <div style={{ padding: "40px 28px", overflowY: "auto", flex: 1 }}>
          <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 24, color: theme.text, margin: 0, letterSpacing: 1 }}>✒ Manuscripts</h2>
          <p style={{ fontSize: 13, color: theme.textDim, marginTop: 6, lineHeight: 1.6, maxWidth: 520 }}>Write your novels with full access to your codex. Organize by Acts, Chapters, and Scenes.</p>
          <Ornament width={300} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 24 }}>
            {manuscripts.map((ms) => {
              const wc = ms.acts.reduce((t, a) => t + a.chapters.reduce((tc, c) => tc + c.scenes.reduce((ts, s) => ts + countWords(s.body), 0), 0), 0);
              const chCount = ms.acts.reduce((t, a) => t + a.chapters.length, 0);
              const scCount = ms.acts.reduce((t, a) => t + a.chapters.reduce((tc, c) => tc + c.scenes.length, 0), 0);
              return (
                <div key={ms.id} onClick={() => { setActiveMs(ms); setNovelView("outline"); }} style={{ width: 240, padding: "20px 18px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.border, borderRadius: 10, cursor: "pointer", transition: "all 0.2s", position: "relative" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = ta(theme.accent, 0.4); e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.transform = "none"; }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #f0c040, #e07050)", borderRadius: "10px 10px 0 0" }} />
                  <div style={{ fontSize: 28, marginBottom: 10 }}>📖</div>
                  <div style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, fontWeight: 600, letterSpacing: 0.5 }}>{ms.title}</div>
                  {ms.description && <div style={{ fontSize: 11, color: theme.textDim, marginTop: 4, lineHeight: 1.4 }}>{ms.description.slice(0, 80)}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 12, fontSize: 10, color: theme.textDim, flexWrap: "wrap" }}>
                    <span style={{ background: ta(theme.accent, 0.08), padding: "2px 8px", borderRadius: 8 }}>{ms.acts.length} act{ms.acts.length !== 1 ? "s" : ""}</span>
                    <span style={{ background: "rgba(126,200,227,0.08)", padding: "2px 8px", borderRadius: 8 }}>{chCount} ch</span>
                    <span style={{ background: "rgba(142,200,160,0.08)", padding: "2px 8px", borderRadius: 8 }}>{scCount} scenes</span>
                    <span style={{ background: "rgba(192,132,252,0.08)", padding: "2px 8px", borderRadius: 8 }}>{wc.toLocaleString()} words</span>
                  </div>
                </div>
              );
            })}
            <div onClick={() => setShowMsCreate(true)} style={{ width: 240, padding: "20px 18px", background: "transparent", border: "2px dashed #1e2a3a", borderRadius: 10, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 140, transition: "all 0.2s" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = ta(theme.accent, 0.4); }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; }}>
              <div style={{ fontSize: 32, color: "#334455" }}>+</div>
              <div style={{ fontSize: 12, color: theme.textDim, marginTop: 6 }}>New Manuscript</div>
            </div>
          </div>
          {showMsCreate && (
            <div style={{ marginTop: 20, background: ta(theme.surface, 0.6), border: "1px solid " + theme.border, borderRadius: 10, padding: "20px 24px", maxWidth: 400 }}>
              <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: theme.accent, margin: "0 0 14px" }}>New Manuscript</h3>
              <input style={S.input} placeholder="Title" value={novelMsForm.title} onChange={(e) => setNovelMsForm((f) => ({ ...f, title: e.target.value }))} autoFocus />
              <textarea style={{ ...S.textarea, minHeight: 50, marginTop: 8 }} placeholder="Description (optional)" value={novelMsForm.description} onChange={(e) => setNovelMsForm((f) => ({ ...f, description: e.target.value }))} />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={createManuscript} disabled={!novelMsForm.title.trim()} style={{ ...tBtnP, fontSize: 11, opacity: novelMsForm.title.trim() ? 1 : 0.4 }}>Create</button>
                <button onClick={() => setShowMsCreate(false)} style={{ ...tBtnS, fontSize: 11 }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Outline Mode — Enhanced */}
      {novelView === "outline" && activeMs && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "14px 28px", borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span onClick={() => { setNovelView("select"); setActiveMs(null); }} style={{ cursor: "pointer", color: theme.textDim, fontSize: 11 }}>← Manuscripts</span>
              <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: theme.text, margin: 0, letterSpacing: 1 }}>{activeMs.title}</h2>
              <span style={{ fontSize: 11, color: theme.textDim }}>{msWordCount.total.toLocaleString()} words</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setNovelView("corkboard")} style={{ ...tBtnS, fontSize: 10, padding: "5px 12px" }}>🗂 Corkboard</button>
              <div style={{ position: "relative" }}>
                <button onClick={() => setNovelExportOpen(!novelExportOpen)} disabled={novelCompiling} style={{ ...tBtnS, fontSize: 10, padding: "5px 12px", color: "#8ec8a0", borderColor: "rgba(142,200,160,0.3)", opacity: novelCompiling ? 0.5 : 1 }}>{novelCompiling ? "Exporting..." : "📄 Export ▾"}</button>
                {novelExportOpen && (
                  <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: theme.surface, border: "1px solid " + theme.border, borderRadius: 8, padding: 4, minWidth: 180, zIndex: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                    {[
                      { id: "txt", label: "Plain Text (.txt)", icon: "📝", desc: "Simple, universal format" },
                      { id: "docx", label: "Word Document (.doc)", icon: "📄", desc: "Microsoft Word compatible" },
                      { id: "pdf", label: "PDF (Print Dialog)", icon: "📋", desc: "Opens print-to-PDF dialog" },
                      { id: "html", label: "E-Book HTML (.html)", icon: "📖", desc: "Formatted, e-reader friendly" },
                    ].map((fmt) => (
                      <div key={fmt.id} onClick={() => compileManuscript(fmt.id)}
                        style={{ padding: "8px 12px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "background 0.1s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.08)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        <span style={{ fontSize: 14 }}>{fmt.icon}</span>
                        <div>
                          <div style={{ fontSize: 11, color: theme.text, fontWeight: 500 }}>{fmt.label}</div>
                          <div style={{ fontSize: 9, color: theme.textDim }}>{fmt.desc}</div>
                        </div>
                      </div>
                    ))}
                    <div style={{ borderTop: "1px solid " + theme.divider, marginTop: 4, paddingTop: 4 }}>
                      <div onClick={() => setExportSettingsOpen(!exportSettingsOpen)}
                        style={{ padding: "8px 12px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.08)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        <span style={{ fontSize: 14 }}>⚙</span>
                        <div style={{ fontSize: 11, color: theme.textMuted }}>Export Settings</div>
                      </div>
                    </div>
                    {exportSettingsOpen && (
                      <div style={{ borderTop: "1px solid " + theme.divider, padding: "10px 12px" }}>
                        {[
                          { key: "frontMatter", label: "Include Title & Author" },
                          { key: "chapterBreaks", label: "Page Break per Chapter" },
                          { key: "includeSynopsis", label: "Include Chapter Synopses" },
                          { key: "includeNotes", label: "Include Scene Notes" },
                        ].map((opt) => (
                          <div key={opt.key} onClick={() => setNovelExportSettings((p) => ({ ...p, [opt.key]: !p[opt.key] }))}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                            <div style={{ width: 14, height: 14, borderRadius: 3, border: "1px solid " + (novelExportSettings[opt.key] ? "#8ec8a0" : theme.border), background: novelExportSettings[opt.key] ? "#8ec8a020" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#8ec8a0" }}>
                              {novelExportSettings[opt.key] ? "✓" : ""}
                            </div>
                            <span style={{ fontSize: 10, color: theme.textMuted }}>{opt.label}</span>
                          </div>
                        ))}
                        <div style={{ marginTop: 6 }}>
                          <span style={{ fontSize: 9, color: theme.textDim, display: "block", marginBottom: 4 }}>Scene Breaks:</span>
                          <div style={{ display: "flex", gap: 4 }}>
                            {[{ id: "asterisks", label: "* * *" }, { id: "dash", label: "— — —" }, { id: "blank", label: "Blank" }].map((s) => (
                              <button key={s.id} onClick={() => setNovelExportSettings((p) => ({ ...p, sceneBreaks: s.id }))}
                                style={{ flex: 1, fontSize: 9, padding: "3px 6px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit", background: novelExportSettings.sceneBreaks === s.id ? "rgba(142,200,160,0.1)" : "transparent", border: "1px solid " + (novelExportSettings.sceneBreaks === s.id ? "rgba(142,200,160,0.3)" : theme.border), color: novelExportSettings.sceneBreaks === s.id ? "#8ec8a0" : theme.textDim }}>
                                {s.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button onClick={addAct} style={{ ...tBtnS, fontSize: 10, padding: "5px 12px" }}>+ Act</button>
              <button onClick={() => deleteManuscript(activeMs.id)} style={{ ...tBtnS, fontSize: 10, padding: "5px 12px", color: "#e07050", borderColor: "rgba(224,112,80,0.3)" }}>Delete</button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
            {activeMs.acts.map((act, ai) => (
              <div key={act.id} style={{ marginBottom: 20 }}
                draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; handleOutlineDragStart("act", act.id, null, null, ai); }}
                onDragOver={(e) => handleOutlineDragOver(e, "act_" + act.id)}
                onDrop={() => handleOutlineDrop("act", ai)} onDragEnd={() => { setOutlineDrag(null); setOutlineDragOver(null); }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, cursor: "pointer", opacity: outlineDragOver === "act_" + act.id ? 0.5 : 1, transition: "opacity 0.15s" }}
                  onClick={() => setNovelOutlineCollapsed((prev) => { const n = new Set(prev); n.has(act.id) ? n.delete(act.id) : n.add(act.id); return n; })}>
                  <span style={{ cursor: "grab", color: theme.textDim, fontSize: 10, opacity: 0.4 }} title="Drag to reorder">⠿</span>
                  <div style={{ width: 4, height: 28, background: act.color, borderRadius: 2 }} />
                  <span style={{ fontSize: 10, color: theme.textDim, transform: novelOutlineCollapsed.has(act.id) ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▾</span>
                  <input style={{ background: "none", border: "none", fontFamily: "'Cinzel', serif", fontSize: 16, color: act.color, fontWeight: 700, letterSpacing: 1, outline: "none", flex: 1, cursor: "text", minWidth: 0 }}
                    value={act.title} onClick={(e) => e.stopPropagation()} onChange={(e) => updateAct(act.id, { title: e.target.value })} />
                  <span style={{ fontSize: 10, color: theme.textDim }}>{(msWordCount.acts[act.id] || 0).toLocaleString()} words</span>
                  <button onClick={(e) => { e.stopPropagation(); addChapter(act.id); }} style={{ ...tBtnS, fontSize: 9, padding: "3px 10px" }}>+ Ch</button>
                  {activeMs.acts.length > 1 && <button onClick={(e) => { e.stopPropagation(); deleteAct(act.id); }} style={{ background: "none", border: "none", color: theme.textDim, cursor: "pointer", fontSize: 12, padding: "2px 6px" }}>✕</button>}
                </div>
                {!novelOutlineCollapsed.has(act.id) && (
                  <div style={{ marginLeft: 20 }}>
                    {act.chapters.map((ch, ci) => {
                      const chProg = chapterWordProgress(ch);
                      return (
                      <div key={ch.id} style={{ marginBottom: 10, background: ta(theme.surface, 0.4), border: "1px solid " + (outlineDragOver === "ch_" + ch.id ? ta(theme.accent, 0.4) : theme.divider), borderRadius: 8, overflow: "hidden", transition: "border 0.15s" }}
                        draggable onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; handleOutlineDragStart("chapter", ch.id, act.id, null, ci); }}
                        onDragOver={(e) => { e.stopPropagation(); handleOutlineDragOver(e, "ch_" + ch.id); }}
                        onDrop={(e) => { e.stopPropagation(); handleOutlineDrop("chapter", ci, act.id); }} onDragEnd={() => { setOutlineDrag(null); setOutlineDragOver(null); }}>
                        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid " + theme.surface }}>
                          <span style={{ cursor: "grab", color: theme.textDim, fontSize: 10, opacity: 0.4 }} title="Drag to reorder">⠿</span>
                          <span onClick={() => setNovelOutlineCollapsed((prev) => { const n = new Set(prev); n.has(ch.id) ? n.delete(ch.id) : n.add(ch.id); return n; })}
                            style={{ fontSize: 10, color: theme.textDim, cursor: "pointer", transform: novelOutlineCollapsed.has(ch.id) ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▾</span>
                          <input style={{ background: "none", border: "none", fontSize: 13, color: theme.text, fontWeight: 600, outline: "none", flex: 1, minWidth: 0, fontFamily: "inherit" }}
                            value={ch.title} onChange={(e) => updateChapter(act.id, ch.id, { title: e.target.value })} />
                          <select value={ch.status} onChange={(e) => updateChapter(act.id, ch.id, { status: e.target.value })}
                            style={{ background: theme.inputBg, border: "1px solid " + theme.border, borderRadius: 4, fontSize: 9, color: STATUS_COLORS[ch.status], padding: "2px 6px", cursor: "pointer", outline: "none", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
                            <option value="draft">Draft</option><option value="revised">Revised</option><option value="final">Final</option>
                          </select>
                          <span style={{ fontSize: 10, color: theme.textDim, minWidth: 50, textAlign: "right" }}>{chapterWordCount(ch).toLocaleString()} w</span>
                          <button onClick={() => addScene(act.id, ch.id)} style={{ ...tBtnS, fontSize: 8, padding: "2px 8px" }}>+ Scene</button>
                          {act.chapters.length > 1 && <button onClick={() => deleteChapter(act.id, ch.id)} style={{ background: "none", border: "none", color: theme.textDim, cursor: "pointer", fontSize: 11 }}>✕</button>}
                        </div>
                        <div style={{ padding: "0 14px", display: "flex", alignItems: "center", gap: 8 }}>
                          <input style={{ flex: 1, background: "none", border: "none", fontSize: 11, color: theme.textDim, padding: "6px 0", outline: "none", fontStyle: "italic", fontFamily: "inherit", boxSizing: "border-box" }}
                            placeholder="Chapter synopsis..." value={ch.synopsis || ""} onChange={(e) => updateChapter(act.id, ch.id, { synopsis: e.target.value })} />
                          {/* Chapter word target */}
                          <input type="number" min="0" step="500" placeholder="Target" title="Chapter word target"
                            value={ch.wordTarget || ""} onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateChapter(act.id, ch.id, { wordTarget: Number(e.target.value) || 0 })}
                            style={{ width: 56, background: "none", border: "1px solid " + theme.border, borderRadius: 4, fontSize: 9, color: theme.textDim, padding: "2px 4px", outline: "none", fontFamily: "inherit", textAlign: "right" }} />
                        </div>
                        {/* Chapter word target progress bar */}
                        {chProg && (
                          <div style={{ margin: "0 14px 6px", height: 3, background: theme.surface, borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: chProg.pct + "%", background: chProg.pct >= 100 ? "#8ec8a0" : chProg.pct > 50 ? theme.accent : "#e07050", borderRadius: 2, transition: "width 0.3s" }} />
                          </div>
                        )}
                        {!novelOutlineCollapsed.has(ch.id) && (
                          <div style={{ padding: "4px 14px 10px" }}>
                            {ch.scenes.map((sc, si) => {
                              const scWords = countWords(sc.body);
                              const scColor = SCENE_COLORS.find((c) => c.id === sc.color) || SCENE_COLORS[0];
                              const scStatus = SCENE_STATUSES.find((s) => s.id === (sc.status || "draft")) || SCENE_STATUSES[0];
                              const scProg = sceneWordProgress(sc);
                              return (
                                <div key={sc.id}
                                  draggable onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; handleOutlineDragStart("scene", sc.id, act.id, ch.id, si); }}
                                  onDragOver={(e) => { e.stopPropagation(); handleOutlineDragOver(e, "sc_" + sc.id); }}
                                  onDrop={(e) => { e.stopPropagation(); handleOutlineDrop("scene", si, act.id, ch.id); }}
                                  onDragEnd={() => { setOutlineDrag(null); setOutlineDragOver(null); }}
                                  onClick={() => { setNovelActiveScene({ actId: act.id, chId: ch.id, scId: sc.id }); setNovelView("write"); }}
                                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginTop: 4, borderRadius: 5, cursor: "pointer", transition: "all 0.15s", background: outlineDragOver === "sc_" + sc.id ? ta(theme.accent, 0.12) : ta(theme.accent, 0.02), borderLeft: scColor.color !== "transparent" ? "3px solid " + scColor.color : "3px solid transparent" }}
                                  onMouseEnter={(e) => { if (!outlineDragOver) e.currentTarget.style.background = ta(theme.accent, 0.08); }} onMouseLeave={(e) => { if (!outlineDragOver) e.currentTarget.style.background = ta(theme.accent, 0.02); }}>
                                  <span style={{ cursor: "grab", color: theme.textDim, fontSize: 9, opacity: 0.3 }} title="Drag to reorder">⠿</span>
                                  {/* Scene status badge */}
                                  <span onClick={(e) => { e.stopPropagation(); cycleStatus(act.id, ch.id, sc.id); }}
                                    title={scStatus.label + " — click to cycle"} style={{ fontSize: 9, color: scStatus.color, cursor: "pointer", minWidth: 14, textAlign: "center" }}>{scStatus.icon}</span>
                                  <input style={{ background: "none", border: "none", fontSize: 12, color: theme.textMuted, outline: "none", flex: 1, minWidth: 0, fontFamily: "inherit", cursor: "pointer" }}
                                    value={sc.title} onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); updateScene(act.id, ch.id, sc.id, { title: e.target.value }); }} />
                                  {sc.povCharacter && <span style={{ fontSize: 9, color: "#c084fc", background: "rgba(192,132,252,0.1)", padding: "1px 6px", borderRadius: 8 }}>{sc.povCharacter}</span>}
                                  {sc.label && <span style={{ fontSize: 9, color: scColor.color !== "transparent" ? scColor.color : theme.textDim, background: (scColor.color !== "transparent" ? scColor.color : theme.textDim) + "18", padding: "1px 6px", borderRadius: 8 }}>{sc.label || scColor.label}</span>}
                                  {/* Word count with optional target */}
                                  <span style={{ fontSize: 9, color: scProg ? (scProg.pct >= 100 ? "#8ec8a0" : theme.textDim) : theme.textDim }}>
                                    {scWords > 0 ? scWords.toLocaleString() : "—"}{scProg ? "/" + scProg.target.toLocaleString() : ""} w
                                  </span>
                                  {sc.notes && <span style={{ fontSize: 9, color: theme.accent }} title="Has notes">📝</span>}
                                  {sc.snapshots?.length > 0 && <span style={{ fontSize: 9, color: "#7ec8e3" }} title={sc.snapshots.length + " snapshot(s)"}>📸{sc.snapshots.length}</span>}
                                  {ch.scenes.length > 1 && <button onClick={(e) => { e.stopPropagation(); deleteScene(act.id, ch.id, sc.id); }} style={{ background: "none", border: "none", color: "#334455", cursor: "pointer", fontSize: 10 }}>✕</button>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );})}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === CORKBOARD VIEW === */}
      {novelView === "corkboard" && activeMs && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "14px 28px", borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <span onClick={() => setNovelView("outline")} style={{ cursor: "pointer", color: theme.textDim, fontSize: 11 }}>← Outline</span>
            <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: theme.text, margin: 0, letterSpacing: 1 }}>🗂 Corkboard</h2>
            <div style={{ flex: 1 }} />
            {/* Chapter filter */}
            <select value={corkboardChapter ? corkboardChapter.actId + "|" + corkboardChapter.chId : "all"}
              onChange={(e) => {
                if (e.target.value === "all") setCorkboardChapter(null);
                else { const [a, c] = e.target.value.split("|"); setCorkboardChapter({ actId: a, chId: c }); }
              }}
              style={{ background: theme.inputBg, border: "1px solid " + theme.border, borderRadius: 6, fontSize: 11, color: theme.text, padding: "4px 10px", outline: "none" }}>
              <option value="all">All Chapters</option>
              {activeMs.acts.map((a) => a.chapters.map((c) => (
                <option key={c.id} value={a.id + "|" + c.id}>{a.title} › {c.title}</option>
              )))}
            </select>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
            {activeMs.acts.filter((a) => !corkboardChapter || a.id === corkboardChapter.actId).map((act) => (
              act.chapters.filter((c) => !corkboardChapter || c.id === corkboardChapter.chId).map((ch) => (
                <div key={ch.id} style={{ marginBottom: 28 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 3, height: 16, background: act.color, borderRadius: 2 }} />
                    <span style={{ fontSize: 13, color: act.color, fontWeight: 700, fontFamily: "'Cinzel', serif" }}>{act.title}</span>
                    <span style={{ color: "#334455" }}>›</span>
                    <span style={{ fontSize: 13, color: theme.text, fontWeight: 600 }}>{ch.title}</span>
                    <span style={{ fontSize: 10, color: theme.textDim }}>{chapterWordCount(ch).toLocaleString()} words</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                    {ch.scenes.map((sc, si) => {
                      const scWords = countWords(sc.body);
                      const scColor = SCENE_COLORS.find((c) => c.id === sc.color) || SCENE_COLORS[0];
                      const scStatus = SCENE_STATUSES.find((s) => s.id === (sc.status || "draft")) || SCENE_STATUSES[0];
                      const scProg = sceneWordProgress(sc);
                      return (
                        <div key={sc.id}
                          draggable onDragStart={() => setCorkboardDragId(sc.id)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => { if (corkboardDragId && corkboardDragId !== sc.id) handleCorkDrop(act.id, ch.id, corkboardDragId, sc.id); setCorkboardDragId(null); }}
                          onClick={() => { setNovelActiveScene({ actId: act.id, chId: ch.id, scId: sc.id }); setNovelView("write"); }}
                          style={{
                            width: isMobile ? "100%" : 200, minHeight: 140, padding: "14px 16px",
                            background: corkboardDragId === sc.id ? ta(theme.accent, 0.15) : ta(theme.surface, 0.6),
                            borderTop: "3px solid " + (scColor.color !== "transparent" ? scColor.color : theme.border),
                            borderRight: "1px solid " + (corkboardDragId === sc.id ? ta(theme.accent, 0.4) : theme.border),
                            borderBottom: "1px solid " + (corkboardDragId === sc.id ? ta(theme.accent, 0.4) : theme.border),
                            borderLeft: "1px solid " + (corkboardDragId === sc.id ? ta(theme.accent, 0.4) : theme.border),
                            borderRadius: 8, cursor: "grab", transition: "all 0.2s", position: "relative",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.4)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                            <div style={{ fontSize: 13, color: theme.text, fontWeight: 600, lineHeight: 1.3, flex: 1 }}>{sc.title}</div>
                            <span onClick={(e) => { e.stopPropagation(); cycleStatus(act.id, ch.id, sc.id); }}
                              title={scStatus.label} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 6, background: scStatus.color + "18", color: scStatus.color, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
                              {scStatus.icon}
                            </span>
                          </div>
                          {sc.povCharacter && <div style={{ fontSize: 9, color: "#c084fc", marginBottom: 4 }}>POV: {sc.povCharacter}</div>}
                          {sc.label && <div style={{ fontSize: 9, color: scColor.color !== "transparent" ? scColor.color : "#6b7b8d", marginBottom: 4 }}>{sc.label}</div>}
                          <div style={{ fontSize: 10, color: theme.textDim, lineHeight: 1.4, overflow: "hidden", maxHeight: 52 }}>
                            {sc.body ? stripTags(sc.body.replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1")).slice(0, 120) + (stripTags(sc.body).length > 120 ? "..." : "") : <span style={{ fontStyle: "italic", color: theme.textDim }}>Empty scene</span>}
                          </div>
                          <div style={{ position: "absolute", bottom: 10, left: 16, right: 16 }}>
                            {scProg && (
                              <div style={{ height: 2, background: theme.surface, borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
                                <div style={{ height: "100%", width: scProg.pct + "%", background: scProg.pct >= 100 ? "#8ec8a0" : theme.accent, borderRadius: 2, transition: "width 0.3s" }} />
                              </div>
                            )}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 9, color: theme.textDim }}>{scWords > 0 ? scWords.toLocaleString() + "w" : "—"}{scProg ? "/" + scProg.target.toLocaleString() : ""}</span>
                              <div style={{ display: "flex", gap: 4 }}>
                                {sc.notes && <span style={{ fontSize: 9 }} title="Has notes">📝</span>}
                                {sc.snapshots?.length > 0 && <span style={{ fontSize: 9 }} aria-hidden="true">📸</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div onClick={() => addScene(act.id, ch.id)}
                      style={{ width: 200, minHeight: 140, border: "2px dashed #1e2a3a", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = ta(theme.accent, 0.4); }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; }}>
                      <span style={{ color: theme.textDim, fontSize: 24 }}>+</span>
                    </div>
                  </div>
                </div>
              ))
            ))}
          </div>
        </div>
      )}

      {/* === WRITING MODE — Enhanced === */}
      {novelView === "write" && activeMs && (() => {
        const scene = getActiveScene();
        const act = activeMs.acts.find((a) => a.id === novelActiveScene?.actId);
        const ch = act?.chapters.find((c) => c.id === novelActiveScene?.chId);
        if (!scene || !act || !ch) return <div style={{ padding: 40, color: theme.textDim }}>No scene selected.</div>;
        const scWords = countWords(scene.body);
        const scColor = SCENE_COLORS.find((c) => c.id === (scene.color || "none")) || SCENE_COLORS[0];
        const mentionMatches = novelMention ? articles.filter((a) => {
          if (!novelMention.query) return true;
          const q = lower(novelMention?.query);
          return lower(a.title).includes(q) || lower(a.id).startsWith(q);
        }).slice(0, 8) : [];

        // Focus mode — fullscreen overlay
        if (novelFocusMode) return (
          <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: theme.deepBg, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ position: "absolute", top: 16, right: 20, display: "flex", gap: 10, opacity: 0.3, transition: "opacity 0.3s" }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }} onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.3"; }}>
              <span style={{ fontSize: 11, color: theme.textDim }}>{scWords.toLocaleString()} words</span>
              {novelGoal.daily > 0 && <span style={{ fontSize: 11, color: goalProgress >= 100 ? "#8ec8a0" : theme.accent }}>{sessionWords}/{novelGoal.daily} today</span>}
              <button onClick={() => setNovelFocusMode(false)} style={{ background: "none", border: "1px solid " + theme.border, color: theme.textDim, borderRadius: 6, padding: "3px 12px", cursor: "pointer", fontSize: 10 }}>Exit Focus</button>
            </div>
            <div style={{ position: "absolute", top: 16, left: 20, opacity: 0.15 }}>
              <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: theme.textDim }}>{act.title} › {ch.title} › {scene.title}</span>
            </div>
            {/* Typewriter progress bar */}
            {novelGoal.daily > 0 && <div style={{ position: "absolute", top: 0, left: 0, height: 2, background: goalProgress >= 100 ? "#8ec8a0" : theme.accent, width: goalProgress + "%", transition: "width 0.5s", borderRadius: 1 }} />}
            <div style={{ flex: 1, width: "100%", maxWidth: 680, display: "flex", flexDirection: "column", overflow: "hidden", padding: "60px 0 40px" }}>
              <div
                ref={novelEditorRef}
                contentEditable suppressContentEditableWarning aria-label="Scene editor" role="textbox" aria-multiline="true"
                spellCheck={settings.spellCheck !== false}
                onInput={handleNovelInput}
                onClick={handleEditorClick}
                onMouseOver={handleEditorMouseOver}
                onMouseLeave={() => setMentionTooltip(null)}
                onCompositionStart={() => { isComposingRef.current = true; }}
                onCompositionEnd={() => { isComposingRef.current = false; handleNovelInput(); }}
                onKeyDown={(e) => {
                  handleAutoCorrectKeyDown(e);
                  if (e.key === "Escape") { if (novelMention) setNovelMention(null); else setNovelFocusMode(false); }
                  if (novelMention && mentionMatches.length > 0 && (e.key === "Tab" || e.key === "Enter")) { e.preventDefault(); insertMention(mentionMatches[0]); }
                  if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
                    if (e.key === "b") { e.preventDefault(); execFormat("bold"); }
                    if (e.key === "i") { e.preventDefault(); execFormat("italic"); }
                    if (e.key === "u") { e.preventDefault(); execFormat("underline"); }
                    if (e.key === "Enter") { e.preventDefault(); runAiAssist("continue"); }
                  }
                  handleMentionKeyDown(e);
                }}
                onBlur={() => setTimeout(() => setNovelMention(null), 200)}
                data-placeholder={"Begin writing...\nType @ to reference codex entries."}
                style={{
                  flex: 1, width: "100%", background: "transparent", border: "none",
                  color: theme.text, caretColor: theme.accent,
                  fontSize: 18, fontFamily: editorFontFamily,
                  lineHeight: 2.2, padding: "0 20px", outline: "none", resize: "none",
                  letterSpacing: 0.4, overflowY: "auto", whiteSpace: "pre-wrap", wordWrap: "break-word",
                }}
              />
              {/* Minimal focus mode formatting bar */}
              <div style={{ display: "flex", justifyContent: "center", gap: 2, padding: "8px 0 0", opacity: 0.25, transition: "opacity 0.3s" }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }} onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.25"; }}>
                {[
                  { cmd: "bold", icon: "B", style: { fontWeight: 800 } },
                  { cmd: "italic", icon: "I", style: { fontStyle: "italic" } },
                  { cmd: "underline", icon: "U", style: { textDecoration: "underline" } },
                  { cmd: "strikeThrough", icon: "S", style: { textDecoration: "line-through" } },
                ].map((b) => (
                  <button key={b.cmd}
                    onMouseDown={(e) => { e.preventDefault(); execFormat(b.cmd); }}
                    style={{ width: 26, height: 24, border: "none", borderRadius: 4, background: "transparent", color: theme.textDim, cursor: "pointer", fontSize: 12, fontFamily: "Georgia, serif", display: "flex", alignItems: "center", justifyContent: "center", ...b.style }}>
                    {b.icon}
                  </button>
                ))}
              </div>
            </div>
            {/* @mention autocomplete in focus mode */}
            {novelMention && mentionMatches.length > 0 && (
              <div style={{ position: "fixed", left: Math.max(10, novelMention.x), top: novelMention.y, background: theme.surface, border: "1px solid " + ta(theme.accent, 0.3), borderRadius: 10, padding: 6, minWidth: 260, maxHeight: 280, overflowY: "auto", zIndex: 10000, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                <div style={{ padding: "4px 10px 6px", fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Codex entries</div>
                {mentionMatches.map((a, idx) => (
                  <div key={a.id} onMouseDown={(e) => { e.preventDefault(); insertMention(a); }}
                    style={{ padding: "8px 12px", fontSize: 12, color: theme.text, cursor: "pointer", borderRadius: 6, display: "flex", alignItems: "center", gap: 8, background: idx === 0 ? ta(theme.accent, 0.08) : "transparent" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.12); }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = idx === 0 ? ta(theme.accent, 0.08) : "transparent"; }}>
                    <span style={{ fontSize: 14, color: CATEGORIES[a.category]?.color }}>{CATEGORIES[a.category]?.icon}</span>
                    <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{a.title}</div></div>
                    <span style={{ fontSize: 9, color: theme.textDim }}>{CATEGORIES[a.category]?.label}</span>
                  </div>
                ))}
              </div>
            )}
            {mentionTooltip && mentionTooltip.article && (
              <div style={{ position: "fixed", left: mentionTooltip.x, top: mentionTooltip.y, background: theme.surface, border: "1px solid " + theme.border, borderRadius: 10, padding: "12px 14px", minWidth: 240, maxWidth: 320, zIndex: 10001, boxShadow: "0 8px 24px rgba(0,0,0,0.6)", pointerEvents: "none" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: CATEGORIES[mentionTooltip.article.category]?.color, fontFamily: "'Cinzel', serif" }}>{CATEGORIES[mentionTooltip.article.category]?.icon} {mentionTooltip.article.title}</div>
                <div style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.5, marginTop: 4 }}>{mentionTooltip.article.summary?.slice(0, 120) || "No summary."}</div>
              </div>
            )}
          </div>
        );

        // Normal write mode
        return (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Writing toolbar */}
            <div style={{ padding: "8px 20px", borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
              <span onClick={() => setNovelView("outline")} style={{ cursor: "pointer", color: theme.textDim, fontSize: 11 }}>← Outline</span>
              <div style={{ width: 1, height: 16, background: theme.border }} />
              <span style={{ fontSize: 11, color: act.color, fontWeight: 600 }}>{act.title}</span>
              <span style={{ color: "#334455" }}>›</span>
              <span style={{ fontSize: 11, color: theme.text, fontWeight: 600 }}>{ch.title}</span>
              <span style={{ color: "#334455" }}>›</span>
              <span style={{ fontSize: 11, color: theme.textMuted }}>{scene.title}</span>
              <div style={{ flex: 1 }} />

              {/* Scene color tag */}
              <select value={scene.color || "none"} onChange={(e) => updateScene(act.id, ch.id, scene.id, { color: e.target.value })}
                style={{ background: theme.inputBg, border: "1px solid " + theme.border, borderRadius: 4, fontSize: 9, color: scColor.color !== "transparent" ? scColor.color : "#6b7b8d", padding: "2px 8px", cursor: "pointer", outline: "none" }}>
                {SCENE_COLORS.map((c) => <option key={c.id} value={c.id} style={{ color: c.color !== "transparent" ? c.color : "#ccc" }}>{c.label}</option>)}
              </select>

              <button onClick={() => navigateScene(-1)} style={{ ...tBtnS, fontSize: 10, padding: "3px 10px" }}>←</button>
              <button onClick={() => navigateScene(1)} style={{ ...tBtnS, fontSize: 10, padding: "3px 10px" }}>→</button>
              <div style={{ width: 1, height: 16, background: theme.border }} />
              <button onClick={() => setNovelFocusMode(true)} style={{ ...tBtnS, fontSize: 10, padding: "3px 12px", color: "#c084fc", borderColor: "rgba(192,132,252,0.3)" }} title="Distraction-free writing">{isMobile ? "⊡" : "⊡ Focus"}</button>
              {!isMobile && <button onClick={() => setNovelSplitPane(novelSplitPane ? null : "notes")} style={{ ...tBtnS, fontSize: 10, padding: "3px 12px", background: novelSplitPane ? ta(theme.accent, 0.1) : "transparent", color: novelSplitPane ? theme.accent : theme.textMuted }}>
                ◫ Split
              </button>}
              {/* AI Proofread button */}
              <button onClick={handleProofread} disabled={proofLoading || !settings.aiKeys?.[settings.aiProvider || "anthropic"]}
                title={settings.aiKeys?.[settings.aiProvider || "anthropic"] ? "Proofread scene with AI" : "Add an API key in Settings to enable"}
                style={{ ...tBtnS, fontSize: 10, padding: "3px 12px", color: proofPanelOpen ? "#8ec8a0" : proofLoading ? theme.accent : theme.textDim, borderColor: proofPanelOpen ? "rgba(142,200,160,0.3)" : undefined, background: proofPanelOpen ? "rgba(142,200,160,0.06)" : "transparent", opacity: settings.aiKeys?.[settings.aiProvider || "anthropic"] ? 1 : 0.4 }}>
                {proofLoading ? "⟳ Checking…" : isMobile ? "✓" : "✓ Proofread"}
              </button>
              {proofPanelOpen && proofSuggestions.length > 0 && (
                <button onClick={() => setProofPanelOpen(false)} style={{ ...tBtnS, fontSize: 9, padding: "3px 8px", color: theme.textDim }}>✕</button>
              )}
              {/* AI Writing Assistant */}
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => {
                    const sel = getSelection();
                    if (sel) { runAiAssist("rewrite"); } else { setAiAssistMenuOpen((v) => !v); }
                  }}
                  disabled={aiAssistLoading || !hasApiKey}
                  title={hasApiKey ? (getSelection() ? "Rewrite selected text" : "AI Writing Assistant") : "Add an API key in Settings to enable"}
                  style={{ ...tBtnS, fontSize: 10, padding: "3px 12px", color: aiAssistLoading ? theme.accent : aiAssistResult ? "#c084fc" : theme.textDim, borderColor: aiAssistMenuOpen ? "rgba(192,132,252,0.3)" : undefined, background: aiAssistMenuOpen ? "rgba(192,132,252,0.06)" : "transparent", opacity: hasApiKey ? 1 : 0.4 }}>
                  {aiAssistLoading ? "⟳ Writing…" : isMobile ? "✦" : "✦ AI Assist"} {!isMobile && !aiAssistLoading && <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>}
                </button>
                {aiAssistMenuOpen && (
                  <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: theme.surface, border: "1px solid " + theme.border, borderRadius: 8, padding: "4px 0", zIndex: 300, minWidth: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                    {[
                      { action: "continue", icon: "✍", label: "Continue Writing", hint: "Ctrl+Enter", needsSel: false },
                      { action: "describe", icon: "🌄", label: "Describe Scene", hint: "", needsSel: false },
                      { action: "rewrite", icon: "✦", label: "Rewrite Selection", hint: "", needsSel: true },
                      { action: "expand", icon: "↔", label: "Expand Passage", hint: "", needsSel: true },
                      { action: "dialogue", icon: "💬", label: "Polish Dialogue", hint: "", needsSel: true },
                    ].map((item) => (
                      <div key={item.action} onClick={() => runAiAssist(item.action)}
                        style={{ padding: "8px 14px", fontSize: 12, color: theme.text, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "background 0.1s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.08); }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>{item.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div>{item.label}</div>
                          {item.needsSel && <div style={{ fontSize: 9, color: theme.textDim }}>requires text selection</div>}
                        </div>
                        {item.hint && <kbd style={{ fontSize: 9, color: theme.textDim, background: ta(theme.surface, 0.8), padding: "1px 6px", borderRadius: 3, border: "1px solid " + theme.border }}>{item.hint}</kbd>}
                      </div>
                    ))}
                  </div>
                )}
                {aiAssistMenuOpen && <div style={{ position: "fixed", inset: 0, zIndex: 299 }} onClick={() => setAiAssistMenuOpen(false)} />}
              </div>
              <div style={{ position: "relative" }}>
                <button onClick={() => setNovelEditorSettings(!novelEditorSettings)} style={{ ...tBtnS, fontSize: 10, padding: "3px 12px", color: novelEditorSettings ? theme.accent : theme.textMuted, background: novelEditorSettings ? theme.accentBg : "transparent" }}>⚙ Editor</button>
                {novelEditorSettings && (
                  <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, width: 280, background: theme.surface, border: "1px solid " + theme.border, borderRadius: 10, padding: 16, zIndex: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: theme.text, letterSpacing: 0.5 }}>Editor Settings</span>
                      <span onClick={() => setNovelEditorSettings(false)} style={{ cursor: "pointer", color: theme.textDim, fontSize: 14 }}>✕</span>
                    </div>
                    {/* Editor Font */}
                    <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Font</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
                      {Object.entries(EDITOR_FONTS).map(([fid, fam]) => (
                        <div key={fid} onClick={() => setSettings((p) => ({ ...p, editorFont: fid }))}
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, cursor: "pointer", border: "1px solid " + (settings.editorFont === fid ? theme.accent + "50" : "transparent"), background: settings.editorFont === fid ? theme.accentBg : "transparent" }}>
                          <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid " + (settings.editorFont === fid ? theme.accent : theme.border), display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {settings.editorFont === fid && <div style={{ width: 7, height: 7, borderRadius: "50%", background: theme.accent }} />}
                          </div>
                          <span style={{ fontSize: 12, fontFamily: fam, color: settings.editorFont === fid ? theme.accent : theme.textMuted }}>{fid === "system" ? "Sans-Serif" : fid === "mono" ? "Monospace" : fid.charAt(0).toUpperCase() + fid.slice(1)}</span>
                        </div>
                      ))}
                    </div>
                    {/* Font Size */}
                    <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Size</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[{ id: "compact", label: "Compact" }, { id: "default", label: "Default" }, { id: "large", label: "Large" }].map((s) => (
                        <button key={s.id} onClick={() => setSettings((p) => ({ ...p, fontSize: s.id }))}
                          style={{ flex: 1, padding: "6px 0", borderRadius: 6, cursor: "pointer", border: "1px solid " + (settings.fontSize === s.id ? theme.accent + "50" : theme.border), background: settings.fontSize === s.id ? theme.accentBg : "transparent", color: settings.fontSize === s.id ? theme.accent : theme.textMuted, fontSize: 10, fontFamily: "inherit" }}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                    {/* Writing Tools */}
                    <div style={{ borderTop: "1px solid " + theme.border, marginTop: 14, paddingTop: 14 }}>
                      <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, fontWeight: 600 }}>Writing Tools</label>
                      {[
                        { key: "spellCheck", label: "Spellcheck", desc: "Browser underlines for misspellings", icon: "✏" },
                        { key: "autoCorrect", label: "AutoCorrect", desc: "Fix common typos as you type", icon: "⚡" },
                      ].map((tool) => (
                        <div key={tool.key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, cursor: "pointer" }}
                          onClick={() => setSettings((p) => ({ ...p, [tool.key]: p[tool.key] === false ? true : p[tool.key] === true ? false : !(p[tool.key] !== false) }))}>
                          <div style={{
                            width: 32, height: 18, borderRadius: 9, position: "relative", transition: "background 0.2s",
                            background: settings[tool.key] !== false ? theme.accent : theme.border,
                          }}>
                            <div style={{
                              width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2,
                              left: settings[tool.key] !== false ? 16 : 2, transition: "left 0.2s",
                            }} />
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.text, fontWeight: 500 }}>{tool.icon} {tool.label}</div>
                            <div style={{ fontSize: 9, color: theme.textDim }}>{tool.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Writing goal bar */}
            {(novelGoal.daily > 0 || novelShowGoalSet) && (
              <div style={{ padding: "6px 20px", borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: "center", gap: 10, flexShrink: 0, background: ta(theme.surface, 0.3) }}>
                {novelShowGoalSet ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, color: theme.textDim }}>Daily word goal:</span>
                    <input type="number" style={{ ...S.input, width: 80, padding: "3px 8px", fontSize: 11 }} placeholder="e.g. 1000" value={novelGoalInput}
                      onChange={(e) => setNovelGoalInput(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter") { setNovelGoal((g) => ({ ...g, daily: parseInt(novelGoalInput) || 0 })); setNovelShowGoalSet(false); } }} />
                    <button onClick={() => { setNovelGoal((g) => ({ ...g, daily: parseInt(novelGoalInput) || 0 })); setNovelShowGoalSet(false); }} style={{ ...tBtnS, fontSize: 9, padding: "3px 10px" }}>Set</button>
                    <button onClick={() => { setNovelGoal((g) => ({ ...g, daily: 0 })); setNovelShowGoalSet(false); }} style={{ ...tBtnS, fontSize: 9, padding: "3px 10px", color: "#e07050" }}>Clear</button>
                  </div>
                ) : (
                  <>
                    <span style={{ fontSize: 10, color: theme.textDim }}>Session:</span>
                    <span style={{ fontSize: 11, color: sessionWords > 0 ? "#8ec8a0" : theme.textDim, fontWeight: 600 }}>+{sessionWords.toLocaleString()}</span>
                    <div style={{ flex: 1, height: 4, background: theme.surface, borderRadius: 2, maxWidth: 200, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: goalProgress + "%", background: goalProgress >= 100 ? "#8ec8a0" : goalProgress > 50 ? theme.accent : "#e07050", borderRadius: 2, transition: "width 0.5s" }} />
                    </div>
                    <span style={{ fontSize: 10, color: goalProgress >= 100 ? "#8ec8a0" : theme.textDim }}>{goalProgress}% of {novelGoal.daily.toLocaleString()}</span>
                    {goalProgress >= 100 && <span style={{ fontSize: 10, color: "#8ec8a0" }}>🎉 Goal reached!</span>}
                    <span onClick={() => { setNovelGoalInput(String(novelGoal.daily)); setNovelShowGoalSet(true); }} style={{ fontSize: 9, color: theme.textDim, cursor: "pointer" }}>✎</span>
                  </>
                )}
              </div>
            )}

            {/* ═══ Proofread Suggestions Panel ═══ */}
            {proofPanelOpen && (
              <div style={{ borderBottom: "1px solid " + theme.divider, maxHeight: 220, overflowY: "auto", flexShrink: 0, background: ta(theme.surface, 0.4) }}>
                <div style={{ padding: "10px 20px" }}>
                  {proofLoading ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                      <span style={{ fontSize: 14, animation: "spin 1s linear infinite" }}>⟳</span>
                      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                      <span style={{ fontSize: 12, color: theme.textMuted }}>AI is reviewing your writing…</span>
                    </div>
                  ) : proofError ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                      <span style={{ fontSize: 12, color: "#e07050" }}>⚠</span>
                      <span style={{ fontSize: 11, color: "#e07050" }}>{proofError}</span>
                      <button onClick={() => setProofPanelOpen(false)} style={{ ...tBtnS, fontSize: 9, padding: "3px 8px", marginLeft: "auto" }}>Dismiss</button>
                    </div>
                  ) : proofSuggestions.length === 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                      <span style={{ fontSize: 14 }}>✨</span>
                      <span style={{ fontSize: 12, color: "#8ec8a0", fontWeight: 500 }}>No issues found — your writing looks clean!</span>
                      <button onClick={() => setProofPanelOpen(false)} style={{ ...tBtnS, fontSize: 9, padding: "3px 8px", marginLeft: "auto" }}>Close</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 11, color: theme.textMuted, fontWeight: 600 }}>
                          {proofSuggestions.length} suggestion{proofSuggestions.length !== 1 ? "s" : ""}
                        </span>
                        <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
                          {Object.entries(SUGGESTION_STYLES).map(([type, s]) => {
                            const count = proofSuggestions.filter((p) => p.type === type).length;
                            return count > 0 ? (
                              <span key={type} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: s.color + "18", color: s.color, fontWeight: 600 }}>
                                {s.icon} {count}
                              </span>
                            ) : null;
                          })}
                        </div>
                        <div style={{ flex: 1 }} />
                        <button onClick={() => {
                          proofSuggestions.forEach((s) => applySuggestion(s, 0));
                          setProofSuggestions([]);
                        }} style={{ ...tBtnS, fontSize: 9, padding: "3px 10px", color: "#8ec8a0", borderColor: "rgba(142,200,160,0.3)" }}>Accept All</button>
                        <button onClick={() => { setProofSuggestions([]); setProofPanelOpen(false); }} style={{ ...tBtnS, fontSize: 9, padding: "3px 8px" }}>Clear All</button>
                      </div>
                      {proofSuggestions.map((s, i) => {
                        const style = SUGGESTION_STYLES[s.type] || SUGGESTION_STYLES.grammar;
                        return (
                          <div key={s.original + i} style={{
                            display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", marginBottom: 4,
                            borderRadius: 6, border: "1px solid " + theme.border,
                            background: ta(theme.surface, 0.3), transition: "all 0.2s",
                          }}>
                            <span style={{ fontSize: 12, color: style.color, flexShrink: 0, marginTop: 1 }}>{style.icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 11, color: "#e07050", textDecoration: "line-through", opacity: 0.7 }}>{s.original}</span>
                                <span style={{ fontSize: 10, color: theme.textDim }}>→</span>
                                <span style={{ fontSize: 11, color: "#8ec8a0", fontWeight: 600 }}>{s.suggestion}</span>
                              </div>
                              {s.explanation && <div style={{ fontSize: 9, color: theme.textDim, marginTop: 2 }}>{s.explanation}</div>}
                            </div>
                            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                              <button onClick={() => {
                                applySuggestion(s, i);
                                setProofSuggestions((prev) => prev.filter((_, idx) => idx !== i));
                              }} style={{ ...tBtnS, fontSize: 9, padding: "2px 8px", color: "#8ec8a0", borderColor: "rgba(142,200,160,0.3)" }}>Apply</button>
                              <button onClick={() => {
                                setProofSuggestions((prev) => prev.filter((_, idx) => idx !== i));
                              }} style={{ ...tBtnS, fontSize: 9, padding: "2px 8px", color: theme.textDim }} title="Dismiss">✕</button>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ═══ AI Writing Assistant Preview Panel ═══ */}
            {(aiAssistResult || aiAssistLoading || aiAssistError) && (
              <div style={{ borderBottom: "1px solid " + theme.divider, flexShrink: 0, background: ta("rgba(192,132,252,0.03)", 1) }}>
                <div style={{ padding: "10px 20px" }}>
                  {aiAssistLoading ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                      <span style={{ fontSize: 14, animation: "spin 1s linear infinite" }}>✦</span>
                      <span style={{ fontSize: 12, color: "#c084fc" }}>AI is writing…</span>
                    </div>
                  ) : aiAssistError ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                      <span style={{ fontSize: 12, color: "#e07050" }}>⚠</span>
                      <span style={{ fontSize: 11, color: "#e07050" }}>{aiAssistError}</span>
                      <button onClick={() => setAiAssistError(null)} style={{ ...tBtnS, fontSize: 9, padding: "3px 8px", marginLeft: "auto" }}>Dismiss</button>
                    </div>
                  ) : aiAssistResult ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 12, color: "#c084fc", fontWeight: 600 }}>
                          ✦ AI {aiAssistResult.action === "continue" ? "Continuation" : aiAssistResult.action === "describe" ? "Scene Description" : aiAssistResult.action === "rewrite" ? "Rewrite" : aiAssistResult.action === "expand" ? "Expansion" : "Dialogue Polish"}
                        </span>
                        <span style={{ fontSize: 10, color: theme.textDim }}>
                          {aiAssistResult.text.split(/\s+/).length} words
                        </span>
                        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                          <button onClick={acceptAiAssist}
                            style={{ fontSize: 10, color: "#8ec8a0", background: "rgba(142,200,160,0.1)", border: "1px solid rgba(142,200,160,0.25)", borderRadius: 6, padding: "4px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                            ✓ Accept
                          </button>
                          <button onClick={() => runAiAssist(aiAssistResult.action)}
                            style={{ ...tBtnS, fontSize: 10, padding: "4px 12px", color: "#c084fc" }}>
                            ⟳ Retry
                          </button>
                          <button onClick={() => setAiAssistResult(null)}
                            style={{ ...tBtnS, fontSize: 10, padding: "4px 12px", color: "#e07050" }}>
                            ✕ Discard
                          </button>
                        </div>
                      </div>
                      <div style={{
                        maxHeight: 200, overflowY: "auto", padding: "12px 16px",
                        background: ta(theme.surface, 0.5), borderRadius: 8,
                        border: "1px solid rgba(192,132,252,0.15)",
                        fontSize: 13, fontFamily: editorFontFamily, color: theme.text,
                        lineHeight: 1.8, whiteSpace: "pre-wrap",
                      }}>
                        {aiAssistResult.text}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            )}

            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              {/* Chapter nav rail — hidden on mobile */}
              {!isMobile && <div style={{ width: isTablet ? 150 : 180, borderRight: "1px solid " + theme.divider, overflowY: "auto", flexShrink: 0, padding: "12px 0", background: theme.deepBg }}>
                {activeMs.acts.map((a) => (
                  <div key={a.id}>
                    <div style={{ padding: "6px 14px", fontSize: 10, color: a.color, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 3, height: 12, background: a.color, borderRadius: 1 }} />{a.title}
                    </div>
                    {a.chapters.map((c) => (
                      <div key={c.id}>
                        {c.scenes.map((s) => {
                          const sColor = SCENE_COLORS.find((sc) => sc.id === s.color) || SCENE_COLORS[0];
                          return (
                            <div key={s.id} onClick={() => setNovelActiveScene({ actId: a.id, chId: c.id, scId: s.id })}
                              style={{ padding: "5px 14px 5px 26px", fontSize: 11, color: s.id === scene.id ? theme.accent : "#6b7b8d", cursor: "pointer", background: s.id === scene.id ? ta(theme.accent, 0.06) : "transparent", borderLeft: s.id === scene.id ? "2px solid " + theme.accent : sColor.color !== "transparent" ? "2px solid " + sColor.color + "60" : "2px solid transparent", transition: "all 0.15s", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              onMouseEnter={(e) => { if (s.id !== scene.id) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                              onMouseLeave={(e) => { if (s.id !== scene.id) e.currentTarget.style.background = "transparent"; }}>
                              <span style={{ fontSize: 9, color: theme.textDim }}>{c.title.replace(/Chapter\s*/i, "Ch")} · </span>{s.title}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
                {/* Goal set button in nav */}
                <div style={{ padding: "12px 14px", borderTop: "1px solid " + theme.divider, marginTop: 8 }}>
                  <span onClick={() => setNovelShowGoalSet(true)} style={{ fontSize: 10, color: theme.textDim, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>🎯 {novelGoal.daily > 0 ? novelGoal.daily.toLocaleString() + " word goal" : "Set word goal"}</span>
                </div>
              </div>}

              {/* Main editor area */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {/* Scene metadata bar */}
                <div style={{ padding: "6px 20px", borderBottom: "1px solid " + theme.surface, display: "flex", alignItems: "center", gap: 8, flexShrink: 0, background: ta(theme.surface, 0.3) }}>
                  {/* Scene status */}
                  {(() => { const st = SCENE_STATUSES.find((s) => s.id === (scene.status || "draft")) || SCENE_STATUSES[0]; return (
                    <span onClick={() => cycleStatus(act.id, ch.id, scene.id)} title={st.label + " — click to cycle"}
                      style={{ fontSize: 9, padding: "2px 8px", borderRadius: 8, cursor: "pointer", background: st.color + "18", color: st.color, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
                      {st.icon} {st.label}
                    </span>
                  ); })()}
                  <div style={{ width: 1, height: 12, background: theme.divider }} />
                  <input style={{ background: "none", border: "none", fontSize: 10, color: "#c084fc", outline: "none", width: 100, fontFamily: "inherit" }}
                    placeholder="POV character..." value={scene.povCharacter || ""} onChange={(e) => updateScene(act.id, ch.id, scene.id, { povCharacter: e.target.value })} />
                  <div style={{ width: 1, height: 12, background: theme.divider }} />
                  <input style={{ background: "none", border: "none", fontSize: 10, color: theme.textDim, outline: "none", flex: 1, fontFamily: "inherit" }}
                    placeholder="Scene label / notes tag..." value={scene.label || ""} onChange={(e) => updateScene(act.id, ch.id, scene.id, { label: e.target.value })} />
                  <div style={{ width: 1, height: 12, background: theme.divider }} />
                  {/* Scene word target */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 9, color: theme.textDim }}>Target:</span>
                    <input type="number" min="0" step="100" placeholder="—"
                      value={scene.wordTarget || ""} onChange={(e) => updateScene(act.id, ch.id, scene.id, { wordTarget: Number(e.target.value) || 0 })}
                      style={{ width: 48, background: "none", border: "1px solid " + theme.border, borderRadius: 3, fontSize: 9, color: theme.textDim, padding: "1px 4px", outline: "none", fontFamily: "inherit", textAlign: "right" }} />
                  </div>
                  <div style={{ width: 1, height: 12, background: theme.divider }} />
                  <button onClick={() => saveSnapshot(act.id, ch.id, scene.id)} title="Save snapshot of current text"
                    style={{ background: "none", border: "1px solid " + theme.border, borderRadius: 4, color: "#7ec8e3", cursor: "pointer", fontSize: 9, padding: "2px 8px" }}>📸 Snapshot</button>
                  {scene.snapshots?.length > 0 && (
                    <span onClick={() => setNovelSnapshotView(novelSnapshotView !== null ? null : scene.snapshots.length - 1)}
                      style={{ fontSize: 9, color: "#7ec8e3", cursor: "pointer", background: "rgba(126,200,227,0.1)", padding: "2px 8px", borderRadius: 4 }}>
                      {scene.snapshots.length} snapshot{scene.snapshots.length !== 1 ? "s" : ""} {novelSnapshotView !== null ? "▾" : "▸"}
                    </span>
                  )}
                </div>
                {/* Scene word target progress bar */}
                {(() => { const prog = sceneWordProgress(scene); return prog ? (
                  <div style={{ padding: "0 20px", background: ta(theme.surface, 0.2), display: "flex", alignItems: "center", gap: 8, height: 18, flexShrink: 0 }}>
                    <div style={{ flex: 1, height: 3, background: theme.surface, borderRadius: 2, overflow: "hidden", maxWidth: 300 }}>
                      <div style={{ height: "100%", width: prog.pct + "%", background: prog.pct >= 100 ? "#8ec8a0" : prog.pct > 50 ? theme.accent : "#e07050", borderRadius: 2, transition: "width 0.3s" }} />
                    </div>
                    <span style={{ fontSize: 9, color: prog.pct >= 100 ? "#8ec8a0" : theme.textDim }}>{prog.words.toLocaleString()}/{prog.target.toLocaleString()} ({prog.pct}%)</span>
                  </div>
                ) : null; })()}

                {/* Snapshot viewer */}
                {novelSnapshotView !== null && scene.snapshots?.length > 0 && (
                  <div style={{ padding: "10px 20px", borderBottom: "1px solid " + theme.divider, background: "rgba(126,200,227,0.03)", flexShrink: 0, maxHeight: 200, overflowY: "auto" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: "#7ec8e3", fontWeight: 600 }}>📸 Snapshots</span>
                      <div style={{ flex: 1 }} />
                      <span onClick={() => setNovelSnapshotView(null)} style={{ fontSize: 10, color: theme.textDim, cursor: "pointer" }}>✕</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      {scene.snapshots.map((snap, si) => (
                        <span key={si} onClick={() => setNovelSnapshotView(si)}
                          style={{ fontSize: 10, padding: "3px 10px", borderRadius: 6, cursor: "pointer", background: novelSnapshotView === si ? "rgba(126,200,227,0.15)" : ta(theme.surface, 0.5), border: "1px solid " + (novelSnapshotView === si ? "rgba(126,200,227,0.3)" : theme.border), color: novelSnapshotView === si ? "#7ec8e3" : "#6b7b8d" }}>
                          {new Date(snap.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {snap.wordCount}w
                        </span>
                      ))}
                    </div>
                    {scene.snapshots[novelSnapshotView] && (
                      <div>
                        <div style={{ fontSize: 11, color: theme.textDim, lineHeight: 1.6, maxHeight: 80, overflow: "hidden", padding: 8, background: ta(theme.deepBg, 0.5), borderRadius: 6, fontFamily: "'Georgia', serif" }}>
                          {scene.snapshots[novelSnapshotView].body.slice(0, 300) || "(empty)"}...
                        </div>
                        <button onClick={() => { restoreSnapshot(act.id, ch.id, scene.id, novelSnapshotView); setNovelSnapshotView(null); }}
                          style={{ ...tBtnS, fontSize: 10, padding: "4px 12px", marginTop: 6, color: theme.accent, borderColor: ta(theme.accent, 0.3) }}>
                          ↩ Restore this snapshot
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Formatting toolbar */}
                <div style={{ padding: "4px 20px", borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: "center", gap: 2, flexShrink: 0, background: ta(theme.surface, 0.2), flexWrap: "wrap" }}>
                  {[
                    { cmd: "bold", icon: "B", key: "bold", style: { fontWeight: 800 }, tip: "Bold (Ctrl+B)" },
                    { cmd: "italic", icon: "I", key: "italic", style: { fontStyle: "italic", fontFamily: "Georgia, serif" }, tip: "Italic (Ctrl+I)" },
                    { cmd: "underline", icon: "U", key: "underline", style: { textDecoration: "underline" }, tip: "Underline (Ctrl+U)" },
                    { cmd: "strikeThrough", icon: "S", key: "strikethrough", style: { textDecoration: "line-through" }, tip: "Strikethrough" },
                  ].map((b) => (
                    <button key={b.cmd} title={b.tip}
                      onMouseDown={(e) => { e.preventDefault(); execFormat(b.cmd); updateFormatState(); }}
                      style={{ width: 28, height: 26, border: "1px solid " + (formatState[b.key] ? ta(theme.accent, 0.4) : "transparent"), borderRadius: 4, background: formatState[b.key] ? ta(theme.accent, 0.12) : "transparent", color: formatState[b.key] ? theme.accent : theme.textMuted, cursor: "pointer", fontSize: 13, fontFamily: "Georgia, serif", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s", ...b.style }}>
                      {b.icon}
                    </button>
                  ))}
                  <div style={{ width: 1, height: 18, background: theme.border, margin: "0 4px" }} />
                  {[
                    { cmd: "formatBlock", val: "<h2>", icon: "H2", tip: "Heading 2" },
                    { cmd: "formatBlock", val: "<h3>", icon: "H3", tip: "Heading 3" },
                  ].map((b) => (
                    <button key={b.icon} title={b.tip}
                      onMouseDown={(e) => { e.preventDefault(); execFormat(b.cmd, b.val); }}
                      style={{ height: 26, padding: "0 8px", border: "1px solid transparent", borderRadius: 4, background: "transparent", color: theme.textMuted, cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", letterSpacing: 0.5 }}>
                      {b.icon}
                    </button>
                  ))}
                  <div style={{ width: 1, height: 18, background: theme.border, margin: "0 4px" }} />
                  <button title="Bullet list" onMouseDown={(e) => { e.preventDefault(); execFormat("insertUnorderedList"); updateFormatState(); }}
                    style={{ width: 28, height: 26, border: "1px solid " + (formatState.ul ? ta(theme.accent, 0.4) : "transparent"), borderRadius: 4, background: formatState.ul ? ta(theme.accent, 0.12) : "transparent", color: formatState.ul ? theme.accent : theme.textMuted, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    ☰
                  </button>
                  <button title="Numbered list" onMouseDown={(e) => { e.preventDefault(); execFormat("insertOrderedList"); updateFormatState(); }}
                    style={{ width: 28, height: 26, border: "1px solid " + (formatState.ol ? ta(theme.accent, 0.4) : "transparent"), borderRadius: 4, background: formatState.ol ? ta(theme.accent, 0.12) : "transparent", color: formatState.ol ? theme.accent : theme.textMuted, cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    1.
                  </button>
                  <button title="Block quote" onMouseDown={(e) => { e.preventDefault(); execFormat("formatBlock", "<blockquote>"); }}
                    style={{ width: 28, height: 26, border: "1px solid transparent", borderRadius: 4, background: "transparent", color: theme.textMuted, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    ❝
                  </button>
                  <div style={{ width: 1, height: 18, background: theme.border, margin: "0 4px" }} />
                  <button title="Horizontal rule" onMouseDown={(e) => { e.preventDefault(); execFormat("insertHorizontalRule"); }}
                    style={{ width: 28, height: 26, border: "1px solid transparent", borderRadius: 4, background: "transparent", color: theme.textMuted, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    ―
                  </button>
                  <button title="Clear formatting" onMouseDown={(e) => { e.preventDefault(); execFormat("removeFormat"); execFormat("formatBlock", "<div>"); updateFormatState(); }}
                    style={{ width: 28, height: 26, border: "1px solid transparent", borderRadius: 4, background: "transparent", color: theme.textDim, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    ⊘
                  </button>
                </div>

                {/* ContentEditable editor */}
                <div
                  ref={novelEditorRef}
                  contentEditable suppressContentEditableWarning
                  aria-label="Scene editor — focus mode" role="textbox" aria-multiline="true"
                  spellCheck={settings.spellCheck !== false}
                  onInput={handleNovelInput}
                  onClick={handleEditorClick}
                  onMouseOver={handleEditorMouseOver}
                  onMouseLeave={() => setMentionTooltip(null)}
                  onCompositionStart={() => { isComposingRef.current = true; }}
                  onCompositionEnd={() => { isComposingRef.current = false; handleNovelInput(); }}
                  onKeyDown={(e) => {
                    handleAutoCorrectKeyDown(e);
                    if (e.key === "Escape") setNovelMention(null);
                    if (novelMention && mentionMatches.length > 0 && (e.key === "Tab" || e.key === "Enter")) { e.preventDefault(); insertMention(mentionMatches[0]); }
                    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
                      if (e.key === "b") { e.preventDefault(); execFormat("bold"); updateFormatState(); }
                      if (e.key === "i") { e.preventDefault(); execFormat("italic"); updateFormatState(); }
                      if (e.key === "u") { e.preventDefault(); execFormat("underline"); updateFormatState(); }
                      if (e.key === "Enter") { e.preventDefault(); runAiAssist("continue"); }
                    }
                    handleMentionKeyDown(e);
                  }}
                  onKeyUp={updateFormatState}
                  onMouseUp={updateFormatState}
                  onBlur={() => setTimeout(() => setNovelMention(null), 200)}
                  data-placeholder={"Begin writing " + scene.title + "...\nType @ to reference codex entries — they'll appear as clickable links."}
                  style={{
                    flex: 1, width: "100%", background: theme.inputBg, border: "none",
                    color: theme.text, caretColor: theme.accent,
                    fontSize: 15, fontFamily: editorFontFamily,
                    lineHeight: 1.9, padding: "32px 48px", outline: "none", resize: "none",
                    boxSizing: "border-box", letterSpacing: 0.3, overflowY: "auto",
                    whiteSpace: "pre-wrap", wordWrap: "break-word", minHeight: 200,
                  }}
                />

                {/* @mention autocomplete */}
                {novelMention && mentionMatches.length > 0 && (
                  <div style={{ position: "fixed", left: Math.max(10, novelMention.x), top: novelMention.y, background: theme.surface, border: "1px solid " + ta(theme.accent, 0.3), borderRadius: 10, padding: 6, minWidth: 260, maxHeight: 280, overflowY: "auto", zIndex: 100, boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px " + ta(theme.accent, 0.1) }}>
                    <div style={{ padding: "4px 10px 6px", fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Codex entries</div>
                    {mentionMatches.map((a, idx) => (
                      <div key={a.id} onMouseDown={(e) => { e.preventDefault(); insertMention(a); }}
                        style={{ padding: "8px 12px", fontSize: 12, color: theme.text, cursor: "pointer", borderRadius: 6, display: "flex", alignItems: "center", gap: 8, background: idx === 0 ? ta(theme.accent, 0.08) : "transparent", transition: "background 0.1s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.12); }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = idx === 0 ? ta(theme.accent, 0.08) : "transparent"; }}>
                        <span style={{ fontSize: 14, color: CATEGORIES[a.category]?.color || "#888" }}>{CATEGORIES[a.category]?.icon || "?"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                          {a.summary && <div style={{ fontSize: 10, color: theme.textDim, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.summary.slice(0, 60)}</div>}
                        </div>
                        <span style={{ fontSize: 9, color: theme.textDim, flexShrink: 0 }}>{CATEGORIES[a.category]?.label}</span>
                      </div>
                    ))}
                    <div style={{ padding: "6px 10px 4px", fontSize: 9, color: theme.textDim, borderTop: "1px solid " + theme.divider, marginTop: 4 }}>Tab/Enter to insert · Esc to close</div>
                  </div>
                )}

                {/* Mention hover tooltip */}
                {mentionTooltip && mentionTooltip.article && (
                  <div style={{ position: "fixed", left: mentionTooltip.x, top: mentionTooltip.y, background: theme.surface, border: "1px solid " + theme.border, borderRadius: 10, padding: "12px 14px", minWidth: 240, maxWidth: 320, zIndex: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.6)", pointerEvents: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      {mentionTooltip.article.portrait && <img src={mentionTooltip.article.portrait} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", border: "1px solid " + theme.border }} />}
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: CATEGORIES[mentionTooltip.article.category]?.color || "#e8dcc8", fontFamily: "'Cinzel', serif" }}>
                          {CATEGORIES[mentionTooltip.article.category]?.icon} {mentionTooltip.article.title}
                        </div>
                        <div style={{ fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>{CATEGORIES[mentionTooltip.article.category]?.label}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.5 }}>{mentionTooltip.article.summary?.slice(0, 150) || "No summary."}{mentionTooltip.article.summary?.length > 150 ? "…" : ""}</div>
                    {Object.entries(mentionTooltip.article.fields || {}).filter(([_, v]) => v).slice(0, 3).map(([k, v]) => (
                      <div key={k} style={{ fontSize: 10, color: theme.textDim, marginTop: 3 }}><strong style={{ color: theme.textDim }}>{formatKey(k)}:</strong> {String(v).slice(0, 50)}</div>
                    ))}
                    <div style={{ fontSize: 9, color: theme.accent, marginTop: 6 }}>Click mention to open article</div>
                  </div>
                )}

                {/* Scene integrity warnings */}
                {(() => {
                  const sceneWarnings = checkSceneIntegrity(scene.body, articles);
                  if (sceneWarnings.length === 0) return null;
                  return (
                    <div style={{ padding: "6px 28px", background: "rgba(224,112,80,0.04)", borderTop: "1px solid rgba(224,112,80,0.15)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: "#e07050" }}>🛡 {sceneWarnings.length} integrity issue{sceneWarnings.length !== 1 ? "s" : ""}:</span>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                        {sceneWarnings.slice(0, 4).map((w, i) => (
                          <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: w.severity === "error" ? "rgba(224,112,80,0.1)" : ta(theme.accent, 0.1), color: w.severity === "error" ? "#e07050" : theme.accent, border: "1px solid " + (w.severity === "error" ? "rgba(224,112,80,0.2)" : ta(theme.accent, 0.2)) }}>
                            {w.message}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Footer bar */}
                <div style={{ padding: "8px 20px", borderTop: "1px solid " + theme.divider, display: "flex", alignItems: "center", gap: 16, flexShrink: 0, background: theme.deepBg }}>
                  <span style={{ fontSize: 10, color: theme.textDim }}>Scene: <strong style={{ color: theme.textMuted }}>{scWords.toLocaleString()}</strong> words</span>
                  <span style={{ fontSize: 10, color: theme.textDim }}>Chapter: <strong style={{ color: theme.textMuted }}>{chapterWordCount(ch).toLocaleString()}</strong></span>
                  <span style={{ fontSize: 10, color: theme.textDim }}>Total: <strong style={{ color: theme.textMuted }}>{msWordCount.total.toLocaleString()}</strong></span>
                  <div style={{ flex: 1 }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLORS[ch.status] }} />
                    <span style={{ fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>{ch.status}</span>
                  </div>
                  <span style={{ fontSize: 9, color: "#334455" }}>@ codex · ⊡ focus · ◫ split</span>
                </div>
              </div>

              {/* === SPLIT PANE RIGHT SIDE === */}
              {novelSplitPane && !isMobile && (
                <div style={{ width: 340, borderLeft: "1px solid " + theme.divider, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0, background: theme.inputBg }}>
                  {/* Split pane tabs */}
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid " + theme.divider, display: "flex", gap: 4, flexShrink: 0 }}>
                    {[
                      { id: "notes", icon: "📝", label: "Notes" },
                      { id: "codex", icon: "📖", label: "Codex" },
                      { id: "snapshots", icon: "📸", label: "Snapshots" },
                      { id: "scene", icon: "◫", label: "Scene" },
                    ].map((tab) => (
                      <span key={tab.id} onClick={() => setNovelSplitPane(tab.id)}
                        style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, cursor: "pointer", background: novelSplitPane === tab.id ? ta(theme.accent, 0.1) : "transparent", color: novelSplitPane === tab.id ? theme.accent : theme.textDim, border: "1px solid " + (novelSplitPane === tab.id ? ta(theme.accent, 0.25) : "transparent"), transition: "all 0.15s" }}>
                        {tab.icon} {tab.label}
                      </span>
                    ))}
                    <div style={{ flex: 1 }} />
                    <span onClick={() => setNovelSplitPane(null)} style={{ cursor: "pointer", color: theme.textDim, fontSize: 12 }}>✕</span>
                  </div>

                  {/* NOTES PANE */}
                  {novelSplitPane === "notes" && (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                      <div style={{ padding: "10px 14px 6px", flexShrink: 0 }}>
                        <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: theme.accent, letterSpacing: 0.5 }}>Scene Notes</span>
                        <div style={{ fontSize: 10, color: theme.textDim, marginTop: 2 }}>Private notes — won't appear in exports</div>
                      </div>
                      <textarea
                        value={scene.notes || ""}
                        onChange={(e) => updateScene(act.id, ch.id, scene.id, { notes: e.target.value })}
                        placeholder={"Research notes for " + scene.title + "...\n\nCharacter motivations, plot threads, setting details, reminders..."}
                        style={{
                          flex: 1, background: "transparent", border: "none", color: theme.textMuted,
                          fontSize: 13, fontFamily: "'Georgia', serif", lineHeight: 1.7,
                          padding: "8px 14px", outline: "none", resize: "none", overflowY: "auto",
                        }}
                      />
                    </div>
                  )}

                  {/* CODEX PANE (replaces old sidebar) */}
                  {novelSplitPane === "codex" && (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                      <div style={{ padding: "10px 14px", borderBottom: "1px solid " + theme.divider, flexShrink: 0 }}>
                        <input style={{ ...S.input, fontSize: 11, padding: "6px 10px" }} placeholder="Search articles..." value={novelCodexSearch} onChange={(e) => setNovelCodexSearch(e.target.value)} />
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                          <span onClick={() => setNovelCodexFilter("all")} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, cursor: "pointer", background: novelCodexFilter === "all" ? ta(theme.accent, 0.15) : "transparent", color: novelCodexFilter === "all" ? theme.accent : theme.textDim, border: "1px solid " + (novelCodexFilter === "all" ? ta(theme.accent, 0.3) : theme.border) }}>All</span>
                          {["character", "location", "race", "deity", "item", "event"].map((cat) => (
                            <span key={cat} onClick={() => setNovelCodexFilter(cat)} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, cursor: "pointer", background: novelCodexFilter === cat ? CATEGORIES[cat].color + "20" : "transparent", color: novelCodexFilter === cat ? CATEGORIES[cat].color : theme.textDim, border: "1px solid " + (novelCodexFilter === cat ? CATEGORIES[cat].color + "40" : theme.border) }}>
                              {CATEGORIES[cat].icon}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
                        {novelCodexArticles.slice(0, novelCodexVisible).map((a) => (
                          <div key={a.id} style={{ marginBottom: 2, borderRadius: 6, overflow: "hidden" }}>
                            <div onClick={() => setNovelCodexExpanded(novelCodexExpanded === a.id ? null : a.id)}
                              style={{ padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "background 0.15s" }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                              <span style={{ color: CATEGORIES[a.category]?.color, fontSize: 12 }}>{CATEGORIES[a.category]?.icon}</span>
                              <span style={{ fontSize: 12, color: theme.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                              <button onClick={(e) => { e.stopPropagation(); insertMentionFromSidebar(a); }}
                                style={{ background: "none", border: "none", color: theme.textDim, cursor: "pointer", fontSize: 10, padding: "2px 4px" }} title="Insert @mention">@+</button>
                            </div>
                            {novelCodexExpanded === a.id && (
                              <div style={{ padding: "4px 10px 12px 30px" }}>
                                {a.portrait && <img src={a.portrait} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", float: "right", marginLeft: 8, marginBottom: 4, border: "1px solid " + theme.border }} />}
                                <p style={{ fontSize: 11, color: theme.textDim, lineHeight: 1.5, margin: "0 0 6px" }}>{a.summary || "No summary."}</p>
                                {Object.entries(a.fields || {}).filter(([_, v]) => v).slice(0, 5).map(([k, v]) => (
                                  <div key={k} style={{ fontSize: 10, color: theme.textDim, marginBottom: 2 }}><strong style={{ color: theme.textDim }}>{formatKey(k)}:</strong> {String(v).slice(0, 60)}</div>
                                ))}
                                <div onClick={() => { setActiveArticle(a); setView("article"); }} style={{ fontSize: 10, color: theme.accent, cursor: "pointer", marginTop: 6 }}>Open full article →</div>
                              </div>
                            )}
                          </div>
                        ))}
                        {novelCodexArticles.length === 0 && <p style={{ fontSize: 11, color: theme.textDim, textAlign: "center", padding: 20 }}>No matching articles.</p>}
                        {novelCodexArticles.length > novelCodexVisible && (
                          <div style={{ textAlign: "center", padding: "8px 0" }}>
                            <button onClick={() => setNovelCodexVisible((v) => v + NOVEL_CODEX_PAGE)}
                              style={{ ...tBtnS, padding: "6px 16px", fontSize: 10, borderRadius: 6 }}>
                              Show more ({novelCodexArticles.length - novelCodexVisible})
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* SNAPSHOTS PANE */}
                  {novelSplitPane === "snapshots" && (
                    <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: "#7ec8e3", letterSpacing: 0.5 }}>Scene Snapshots</span>
                        <button onClick={() => saveSnapshot(act.id, ch.id, scene.id)} style={{ ...tBtnS, fontSize: 9, padding: "3px 10px", color: "#7ec8e3", borderColor: "rgba(126,200,227,0.3)" }}>📸 Save</button>
                      </div>
                      {(!scene.snapshots || scene.snapshots.length === 0) ? (
                        <div style={{ textAlign: "center", padding: "30px 10px", color: theme.textDim }}>
                          <div style={{ fontSize: 28, marginBottom: 8 }}>📸</div>
                          <p style={{ fontSize: 12 }}>No snapshots yet.</p>
                          <p style={{ fontSize: 10, color: "#334455" }}>Save a snapshot to create a restorable version of this scene.</p>
                        </div>
                      ) : (
                        scene.snapshots.map((snap, si) => (
                          <div key={si} style={{ marginBottom: 10, background: ta(theme.surface, 0.5), border: "1px solid " + theme.border, borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                              <span style={{ fontSize: 11, color: "#7ec8e3" }}>
                                {new Date(snap.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </span>
                              <span style={{ fontSize: 10, color: theme.textDim }}>{snap.wordCount} words</span>
                            </div>
                            <div style={{ fontSize: 11, color: theme.textDim, lineHeight: 1.5, maxHeight: 60, overflow: "hidden", marginBottom: 6 }}>
                              {snap.body.slice(0, 150) || "(empty)"}...
                            </div>
                            <button onClick={() => { restoreSnapshot(act.id, ch.id, scene.id, si); }}
                              style={{ ...tBtnS, fontSize: 9, padding: "3px 10px", color: theme.accent, borderColor: ta(theme.accent, 0.3) }}>↩ Restore</button>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* SCENE SPLIT PANE — side-by-side scene comparison */}
                  {novelSplitPane === "scene" && (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                      <div style={{ padding: "10px 14px", borderBottom: "1px solid " + theme.divider, flexShrink: 0 }}>
                        <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: "#c084fc", letterSpacing: 0.5 }}>Reference Scene</span>
                        <select value={novelSplitSceneId || ""}
                          onChange={(e) => setNovelSplitSceneId(e.target.value || null)}
                          style={{ display: "block", width: "100%", marginTop: 6, background: theme.inputBg, border: "1px solid " + theme.border, borderRadius: 6, fontSize: 11, color: theme.text, padding: "5px 8px", outline: "none" }}>
                          <option value="">Choose a scene...</option>
                          {allScenes.filter((s) => s.id !== scene.id).map((s) => (
                            <option key={s.id} value={s.id}>{s.actTitle} › {s.chTitle} › {s.title}</option>
                          ))}
                        </select>
                      </div>
                      {(() => {
                        const refScene = allScenes.find((s) => s.id === novelSplitSceneId);
                        if (!refScene) return (
                          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: theme.textDim, padding: 20 }}>
                            <div style={{ textAlign: "center" }}>
                              <div style={{ fontSize: 28, marginBottom: 8 }}>◫</div>
                              <p style={{ fontSize: 12 }}>Select a scene to view side by side.</p>
                              <p style={{ fontSize: 10, color: "#334455" }}>Compare notes, check continuity, or reference earlier work.</p>
                            </div>
                          </div>
                        );
                        const refStatus = SCENE_STATUSES.find((st) => st.id === (refScene.status || "draft")) || SCENE_STATUSES[0];
                        return (
                          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <span style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: theme.text, fontWeight: 600 }}>{refScene.title}</span>
                              <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 6, background: refStatus.color + "18", color: refStatus.color }}>{refStatus.icon} {refStatus.label}</span>
                            </div>
                            {refScene.povCharacter && <div style={{ fontSize: 10, color: "#c084fc", marginBottom: 4 }}>POV: {refScene.povCharacter}</div>}
                            <div style={{ fontSize: 10, color: theme.textDim, marginBottom: 8 }}>{countWords(refScene.body).toLocaleString()} words</div>
                            <div style={{
                              fontSize: 13, fontFamily: editorFontFamily, lineHeight: 1.8, color: theme.textMuted,
                              padding: "12px 16px", background: ta(theme.surface, 0.4), borderRadius: 8, border: "1px solid " + theme.border,
                              whiteSpace: "pre-wrap", wordWrap: "break-word", overflowWrap: "break-word",
                            }}
                              dangerouslySetInnerHTML={{ __html: (refScene.body || "<em style='color:" + theme.textDim + "'>Empty scene</em>").replace(/@\[([^\]]+)\]\(([^)]+)\)/g, '<span style="color:' + theme.accent + ';font-weight:600">$1</span>') }}
                            />
                            {refScene.notes && (
                              <div style={{ marginTop: 12, padding: "10px 12px", background: ta(theme.surface, 0.3), borderRadius: 6, border: "1px solid " + theme.border }}>
                                <div style={{ fontSize: 10, color: theme.textDim, fontWeight: 600, marginBottom: 4 }}>📝 Notes</div>
                                <div style={{ fontSize: 11, color: theme.textDim, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{refScene.notes}</div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

    </div>
  );
}