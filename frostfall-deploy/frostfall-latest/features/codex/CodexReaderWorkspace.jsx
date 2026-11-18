"use client";

import { ArrowLeft, BookOpenText, CalendarClock, Hash, Layers3, Link2, ScrollText } from "lucide-react";
import { summarizeCodexReader } from "@/lib/domain/codexReader";
import styles from "./CodexReaderWorkspace.module.css";

const displayDate = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

/**
 * Display-only Codex article masthead. All editing, Canon decisions, navigation,
 * relations and version history remain owned by the existing application.
 * Never imply that viewing an article is a save or a Canon approval.
 */
export function CodexReaderHero({ article, category, worldName, onWorld, onCodex, children }) {
  const info = summarizeCodexReader(article);
  const categoryLabel = category?.label || "Codex entry";
  return (
    <header className={styles.hero} style={{ "--reader-tone": category?.color || "var(--accent)" }}>
      <nav className={styles.breadcrumb} aria-label="Article breadcrumb">
        <button type="button" onClick={onWorld}>World Studio</button>
        <span aria-hidden="true">/</span>
        <button type="button" onClick={onCodex}>Codex Studio</button>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className={styles.breadcrumbCurrent}>{article?.title || "Untitled entry"}</span>
      </nav>
      <div className={styles.heroContent}>
        <div className={styles.cover} aria-hidden={!article?.portrait}>
          {article?.portrait ? <img src={article.portrait} alt="" /> : <span role="img" aria-label={categoryLabel}>{category?.icon || "✦"}</span>}
        </div>
        <div className={styles.heading}>
          <div className={styles.eyebrow}><ScrollText size={14} aria-hidden="true" /> {worldName || "Your World"} <span aria-hidden="true">/</span> {categoryLabel}</div>
          <h1>{article?.title || "Untitled entry"}</h1>
          <div className={styles.badges}>
            <span className={styles.categoryBadge}>{category?.icon} {categoryLabel}</span>
            {article?.temporal?.type && <span className={styles.temporalBadge}><CalendarClock size={13} aria-hidden="true" /> {article.temporal.type}{article.temporal.active_start != null ? " · Year " + article.temporal.active_start : ""}{article.temporal.active_end != null ? "–" + article.temporal.active_end : ""}</span>}
          </div>
          {article?.summary && <p className={styles.summary}>{article.summary}</p>}
        </div>
      </div>
      <div className={styles.details} aria-label="Entry overview">
        <span><BookOpenText size={15} aria-hidden="true" /><strong>{info.wordCount.toLocaleString()}</strong> lore words</span>
        <span><Layers3 size={15} aria-hidden="true" /><strong>{info.filledFields}</strong> properties</span>
        <span><Link2 size={15} aria-hidden="true" /><strong>{info.linkedCount}</strong> linked entries</span>
        <span><Hash size={15} aria-hidden="true" /><strong>{info.tagCount}</strong> tags</span>
        <span className={styles.updated}><CalendarClock size={15} aria-hidden="true" /> Updated {displayDate(article?.updatedAt)}</span>
      </div>
      <div className={styles.heroActions}>
        <button type="button" className={styles.returnButton} onClick={onCodex}><ArrowLeft size={15} aria-hidden="true" /> Back to Codex</button>
        {children}
      </div>
    </header>
  );
}

export function CodexReaderStoryHeading() {
  return (
    <div className={styles.storyHeading}>
      <span className={styles.storyIcon}><BookOpenText size={19} aria-hidden="true" /></span>
      <div><h2>Story & lore</h2><p>The written account and recorded details for this entry.</p></div>
    </div>
  );
}
