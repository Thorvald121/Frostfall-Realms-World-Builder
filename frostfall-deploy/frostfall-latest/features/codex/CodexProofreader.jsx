"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpenCheck, Check, ChevronDown, ChevronUp, LoaderCircle, Plus, SearchCheck } from "lucide-react";
import { loadCodexSpellingEngine, collectCodexSpellingIssues, replaceCodexSpellingIssue,
  codexWordStorageKey, readCodexWordList, saveCodexWordList, normalizeCodexWord } from "@/lib/domain/codexSpelling";
import styles from "./CodexProofreader.module.css";
const HIGHLIGHT_NAME = "fr-codex-spelling";
function browserStorage() { try { return window.localStorage; } catch { return null; } }
function worldNamesFor(articles, worldName) {
  const names = new Set();
  const add = (value) => {
    for (const token of String(value || "").match(/[\p{L}][\p{L}'’-]*/gu) || [])
      if (token.length >= 2) names.add(normalizeCodexWord(token));
  };
  add(worldName);
  for (const article of articles || []) {
    add(article?.title);
    for (const tag of Array.isArray(article?.tags) ? article.tags : []) add(tag);
  }
  return names;
}
/**
 * Application-owned Codex spelling; never puts proof marks inside contentEditable.
 * Each replacement checks the exact Text-node range before mutating it and calls
 * the existing editor's input sync, preserving P11 draft backups and formatting.
 */
export function CodexProofreader({ editorRef, onEditorChange, userId, worldId, worldName, articles = [], entryIdentity }) {
  const scope = codexWordStorageKey(userId, worldId);
  const [engine, setEngine] = useState(null);
  const [status, setStatus] = useState("loading");
  const [issues, setIssues] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [accepted, setAccepted] = useState(new Set());
  const [ignored, setIgnored] = useState(new Set());
  const [includeNames, setIncludeNames] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const scanRef = useRef(() => {});
  const issuesRef = useRef([]);
  issuesRef.current = issues;
  const worldNames = useMemo(() => worldNamesFor(articles, worldName), [articles, worldName]);
  const approved = useMemo(() => new Set([...worldNames, ...accepted]), [worldNames, accepted]);

  useEffect(() => {
    let active = true;
    loadCodexSpellingEngine().then(value => {
      if (active) { setEngine(value); setStatus("ready"); }
    }).catch(() => {
      if (active) { setStatus("error"); setNotice("The offline dictionary could not load. Browser spelling is available temporarily."); }
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    setAccepted(readCodexWordList(browserStorage(), scope));
    setIgnored(new Set());
    setSelectedId(null);
    setNotice("");
    setStorageWarning("");
  }, [scope, entryIdentity]);
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) editor.spellcheck = status === "error";
  }, [editorRef, status]);

  const refresh = useCallback(() => {
    const editor = editorRef.current;
    if (!engine || !editor?.isConnected) return;
    const found = collectCodexSpellingIssues(editor, engine, { approved, ignored, checkNames: includeNames });
    setIssues(found);
    if (typeof window !== "undefined" && window.CSS?.highlights) {
      window.CSS.highlights.delete(HIGHLIGHT_NAME);
      if (window.Highlight && found.length) {
        const ranges = [];
        for (const issue of found) {
          try {
            const range = editor.ownerDocument.createRange();
            range.setStart(issue.node, issue.start);
            range.setEnd(issue.node, issue.end);
            ranges.push(range);
          } catch { /* changed while scanning; next input rescans */ }
        }
        if (ranges.length) window.CSS.highlights.set(HIGHLIGHT_NAME, new window.Highlight(...ranges));
      }
    }
  }, [editorRef, engine, approved, ignored, includeNames]);
  scanRef.current = refresh;

  useEffect(() => {
    const editor = editorRef.current;
    if (!engine || !editor) return;
    let timer;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => scanRef.current(), 650);
    };
    const clickIssue = (event) => {
      const doc = editor.ownerDocument;
      let node, offset;
      if (doc.caretRangeFromPoint) {
        const caret = doc.caretRangeFromPoint(event.clientX, event.clientY);
        node = caret?.startContainer;
        offset = caret?.startOffset;
      } else if (doc.caretPositionFromPoint) {
        const caret = doc.caretPositionFromPoint(event.clientX, event.clientY);
        node = caret?.offsetNode;
        offset = caret?.offset;
      }
      if (node?.nodeType !== 3) return;
      const match = issuesRef.current.find(hit => hit.node === node && offset >= hit.start && offset <= hit.end);
      if (match) { setSelectedId(match.id); setPanelOpen(true); }
    };
    editor.spellcheck = false;
    editor.addEventListener("input", schedule);
    editor.addEventListener("focusout", schedule);
    editor.addEventListener("click", clickIssue);
    timer = setTimeout(() => scanRef.current(), 750);
    return () => {
      clearTimeout(timer);
      editor.removeEventListener("input", schedule);
      editor.removeEventListener("focusout", schedule);
      editor.removeEventListener("click", clickIssue);
      if (window.CSS?.highlights) window.CSS.highlights.delete(HIGHLIGHT_NAME);
    };
  }, [editorRef, engine, entryIdentity]);
  useEffect(() => { if (engine) scanRef.current(); }, [engine, approved, ignored, includeNames]);

  const reveal = useCallback((issue) => {
    const root = editorRef.current;
    if (!issue?.node || !root?.contains(issue.node) || issue.node.data.slice(issue.start, issue.end) !== issue.word) {
      setNotice("That word has changed. The writing assistant will rescan it.");
      scanRef.current();
      return;
    }
    const range = root.ownerDocument.createRange();
    range.setStart(issue.node, issue.start);
    range.setEnd(issue.node, issue.end);
    root.focus();
    const selection = root.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    issue.node.parentElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setSelectedId(issue.id);
  }, [editorRef]);
  const apply = (issue, replacement) => {
    const root = editorRef.current;
    if (!replaceCodexSpellingIssue(root, issue, replacement)) {
      setNotice("The text changed before the correction was applied. Nothing was replaced.");
      scanRef.current();
      return;
    }
    try {
      const caret = root.ownerDocument.createRange();
      caret.setStart(issue.node, issue.start + replacement.length);
      caret.collapse(true);
      const selection = root.ownerDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(caret);
      root.focus();
    } catch { /* insertion succeeded; caret restoration is best effort */ }
    setNotice("Changed “" + issue.word + "” to “" + replacement + "”. Save changes to keep it in your Codex.");
    onEditorChange?.();
    scanRef.current();
  };
  const ignore = (issue) => {
    setIgnored(previous => new Set([...previous, normalizeCodexWord(issue.word)]));
    setNotice("Ignoring “" + issue.word + "” while editing this entry.");
  };
  const addWord = (issue) => {
    const word = normalizeCodexWord(issue.word);
    const next = new Set([...accepted, word]);
    if (!scope || !saveCodexWordList(browserStorage(), scope, next)) {
      setStorageWarning("Browser storage is unavailable. This word will only be ignored during this editing session.");
      setIgnored(previous => new Set([...previous, word]));
      return;
    }
    setAccepted(next);
    setNotice("“" + issue.word + "” added to this world’s browser-local dictionary.");
  };

  return (
    <section className={styles.root} aria-label="Codex Writing Assistant">
      <div className={styles.topBar}>
        <div className={styles.identity}>
          <BookOpenCheck size={17} aria-hidden="true" />
          <div><strong>Writing Assistant</strong><span>Frostfall spelling · offline · English (US)</span></div>
        </div>
        <button type="button" className={styles.toggle} aria-expanded={panelOpen}
          aria-controls="fr-codex-spelling-panel" onClick={() => setPanelOpen(value => !value)}>
          {status === "loading" ? <><LoaderCircle size={14} aria-hidden="true" /> Loading words…</>
            : status === "error" ? <><AlertTriangle size={14} aria-hidden="true" /> Dictionary unavailable</>
              : <><SearchCheck size={14} aria-hidden="true" /> {issues.length} {issues.length === 1 ? "possible typo" : "possible typos"}</>}
          {panelOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
      </div>
      {status === "error" && <p className={styles.error} role="alert">{notice}</p>}
      {panelOpen && (
        <div id="fr-codex-spelling-panel" className={styles.panel}>
          <div className={styles.panelHead}>
            <div><h3>Spelling review</h3><p>Corrections are optional. Nothing is changed automatically, and this review is not a cloud save.</p></div>
            <label className={styles.checkbox}>
              <input type="checkbox" checked={includeNames} onChange={event => setIncludeNames(event.target.checked)} />
              Check possible names
            </label>
          </div>
          {status === "loading" && <p className={styles.empty}>Loading the offline word list…</p>}
          {status === "ready" && !issues.length && <p className={styles.empty}><Check size={16} aria-hidden="true" /> No possible spelling errors found in the current text.</p>}
          {status === "ready" && issues.length > 0 && (
            <div className={styles.issueList} role="list" aria-label="Possible misspellings">
              {issues.map(issue => (
                <div key={issue.id} role="listitem" className={styles.issue + (selectedId === issue.id ? " " + styles.selected : "")}>
                  <div className={styles.issueHeading}>
                    <button type="button" className={styles.word} title="Select this word in the editor" onClick={() => reveal(issue)}>{issue.word}</button>
                    <span>Possible spelling</span>
                  </div>
                  <div className={styles.suggestions}>
                    {issue.suggestions.length > 0 ? issue.suggestions.slice(0, 4).map(suggestion =>
                      <button type="button" key={suggestion} className={styles.suggestion} onClick={() => apply(issue, suggestion)}
                        title={"Replace " + issue.word + " with " + suggestion}>{suggestion}</button>)
                      : <span className={styles.noGuess}>No close replacement. This may be an invented word.</span>}
                  </div>
                  <div className={styles.issueActions}>
                    <button type="button" onClick={() => reveal(issue)}>Show in text</button>
                    <button type="button" onClick={() => ignore(issue)}>Ignore here</button>
                    <button type="button" onClick={() => addWord(issue)}><Plus size={12} aria-hidden="true" /> Add to world words</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {status === "ready" && <p className={styles.footnote}>Article names and tags in this world are valid vocabulary. Added words are browser-local to this account and world; InPrivate sessions may erase them. Grammar and punctuation are separate future capabilities.</p>}
          {storageWarning && <p className={styles.warning} role="alert">{storageWarning}</p>}
          {status === "ready" && notice && <p className={styles.notice} role="status">{notice}</p>}
        </div>
      )}
    </section>
  );
}
