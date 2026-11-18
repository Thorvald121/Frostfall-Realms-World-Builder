"use client";

import { BookOpenText, Check, ChevronLeft, FilePenLine, FilePlus2, Hash, Layers3, Link2, Save, ShieldCheck, Tags } from "lucide-react";
import { draftOverview } from "@/lib/domain/editorDraft";
import styles from "./CodexEditorWorkspace.module.css";

/**
 * View-only authoring shell: all entity persistence, rich-text editing, duplicate
 * detection, canon warnings and recovery remain with the existing editor owner.
 * Do not claim the user's changes were saved until that repository acknowledges it.
 */
export function CodexEditorWorkspace({
  worldName, category, editing, draft, onSave, onCancel, onCodex, children,
}) {
  const info = draftOverview(draft);
  const save = () => {
    if (!info.titleReady) {
      document.getElementById("fr-codex-title")?.focus();
      return;
    }
    onSave();
  };
  const entryName = category?.label || "Codex entry";
  const headings = [
    { id: "fr-editor-identity", label: "Identity", icon: FilePenLine },
    { id: "fr-editor-details", label: "Properties", icon: Layers3 },
    { id: "fr-editor-story", label: "Lore & narrative", icon: BookOpenText },
    { id: "fr-editor-index", label: "Discovery", icon: Tags },
  ];
  return (
    <section className={styles.root} style={{ "--entry-tone": category?.color || "var(--accent)" }} aria-label={`${editing ? "Edit" : "Create"} ${entryName}`}>
      <header className={styles.heading}>
        <div className={styles.titleGroup}>
          <div className={styles.eyebrow}>THE WORLD / {worldName || "YOUR WORLD"} / CODEX</div>
          <div className={styles.titleLine}>
            <span className={styles.typeIcon} aria-hidden="true">{editing ? <FilePenLine size={25} /> : <FilePlus2 size={25} />}</span>
            <div>
              <h1>{editing ? "Edit" : "Create"} {entryName}</h1>
              <p>Build a structured record of your world. Keep its lore, relationships and evidence together.</p>
            </div>
          </div>
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.quietButton} onClick={onCancel}><ChevronLeft size={16} aria-hidden="true" /> Back</button>
          <button type="button" className={styles.primaryButton} onClick={save} disabled={!info.titleReady} title={!info.titleReady ? "Enter a title before saving" : undefined}><Save size={16} aria-hidden="true" /> {editing ? "Save changes" : "Create entry"}</button>
        </div>
      </header>
      <div className={styles.layout}>
        <div className={styles.main}>
          <div className={styles.manualSave}><ShieldCheck size={16} aria-hidden="true" /><span>Manual save · Review your work and select <strong>{editing ? "Save changes" : "Create entry"}</strong> when ready.</span></div>
          {children}
        </div>
        <aside className={styles.rail} aria-label="Editor navigation and draft context">
          <nav className={styles.railPanel} aria-label="Sections of this entry">
            <h2>Entry sections</h2>
            {headings.map(({ id, label, icon: Icon }, index) => <a href={`#${id}`} key={id} className={styles.anchor}><span>{index + 1}</span><Icon size={15} aria-hidden="true" /> {label}</a>)}
          </nav>
          <div className={styles.railPanel}>
            <h2>Draft snapshot</h2>
            <div className={styles.snapshotRow}><Check size={15} aria-hidden="true" /> Title <strong>{info.titleReady ? "Entered" : "Needed"}</strong></div>
            <div className={styles.snapshotRow}><BookOpenText size={15} aria-hidden="true" /> Lore words <strong>{info.wordCount.toLocaleString()}</strong></div>
            <div className={styles.snapshotRow}><Layers3 size={15} aria-hidden="true" /> Filled properties <strong>{info.filledFields}</strong></div>
            <div className={styles.snapshotRow}><Hash size={15} aria-hidden="true" /> Tags <strong>{info.tagCount}</strong></div>
            <p className={styles.snapshotHelp}>These counts describe this on-screen draft. They do not indicate that it has been saved or approved as canon.</p>
          </div>
          <div className={styles.railPanel}>
            <h2>Canon and connections</h2>
            <p className={styles.railText}>Evidence, cross-references, and consistency checks are maintained by your world's existing Canon engine.</p>
            <button type="button" className={styles.railLink} onClick={onCodex}><Link2 size={16} aria-hidden="true" /> Return to Codex Studio</button>
          </div>
        </aside>
      </div>
      <footer className={styles.footer}>
        <span>Nothing is published until you save this entry.</span>
        <div>
          <button type="button" className={styles.quietButton} onClick={onCancel}>Cancel</button>
          <button type="button" className={styles.primaryButton} onClick={save} disabled={!info.titleReady} title={!info.titleReady ? "Enter a title before saving" : undefined}><Save size={16} aria-hidden="true" /> {editing ? "Save changes" : "Create entry"}</button>
        </div>
      </footer>
    </section>
  );
}

/** Field groups are real landmarks with named destinations, not decorative panels. */
export function CodexEditorSection({ id, number, title, description, children }) {
  return (
    <section id={id} className={styles.editorSection} aria-labelledby={`${id}-heading`}>
      <div className={styles.sectionHeading}>
        <span className={styles.stepNumber} aria-hidden="true">{String(number).padStart(2, "0")}</span>
        <div><h2 id={`${id}-heading`}>{title}</h2>{description && <p>{description}</p>}</div>
      </div>
      <div className={styles.sectionContents}>{children}</div>
    </section>
  );
}