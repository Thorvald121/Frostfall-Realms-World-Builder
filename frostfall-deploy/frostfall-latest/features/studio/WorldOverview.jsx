"use client";
import { BookOpen, CalendarRange, GitFork, BookText, Scale, ShieldCheck,
  FileInput, ArrowUpRight, Plus, ChevronRight, Layers3, ScrollText, Globe2 } from "lucide-react";
import { summarizeWorldOverview } from "@/lib/domain/worldOverview";

const modules = [
  { key: "codex", title: "Codex Studio", subtitle: "Your world's people, places and lore", icon: BookOpen, tone: "codex" },
  { key: "timeline", title: "Chronicles", subtitle: "Explore events and their chronology", icon: CalendarRange, tone: "timeline" },
  { key: "canon_studio", title: "Canon Studio", subtitle: "Document truth, evidence and branches", icon: Scale, tone: "canon_studio" },
  { key: "novel", title: "Manuscripts", subtitle: "Write and revise your stories", icon: BookText, tone: "novel" },
  { key: "graph", title: "Relationships", subtitle: "Map connections between entries", icon: GitFork, tone: "graph" },
  { key: "ai_import", title: "Document Import", subtitle: "Bring existing material into your world", icon: FileInput, tone: "ai_import" },
];

export function WorldOverview({ world, worldCount, articles = [], manuscripts = [], integrityCount = 0,
  saveStatus, canEdit, theme, onOpen, onCodex, onArticle, onCreate, onSwitchWorld }) {
  const summary = summarizeWorldOverview({ articles, manuscripts, integrityCount });
  const introduction = (world?.tagline || world?.description || "").trim();
  const statusLabel = saveStatus === "saved" ? "Codex saved" : saveStatus === "saving" ? "Saving changes"
    : saveStatus === "error" ? "Save needs attention" : "Workspace ready";

  return (
    <section className="fr-overview" aria-labelledby="fr-overview-title">
      <div className="fr-overview-eyebrow"><Globe2 size={15} aria-hidden="true" /> THE WORLD / OVERVIEW</div>
      <div className="fr-overview-hero">
        <div className="fr-overview-hero-text">
          <div className="fr-overview-small">ACTIVE WORLD · {world?.member_role === "viewer" ? "VIEWER" : world?.member_role === "editor" ? "EDITOR" : "PRIVATE"}</div>
          <h1 id="fr-overview-title">{world?.name || "Your world"}</h1>
          <p>{introduction || "An entire world is waiting to be explored. Begin with an entry, build your history, or shape its canon."}</p>
          <div className="fr-overview-hero-actions">
            {canEdit && <button type="button" className="fr-overview-primary" onClick={onCreate}><Plus size={17}/> New Codex Entry</button>}
            <button type="button" className="fr-overview-secondary" onClick={onCodex}><BookOpen size={17}/> Open Codex</button>
            {worldCount > 1 && <button type="button" className="fr-overview-secondary" onClick={onSwitchWorld}><Globe2 size={17}/> Switch World</button>}
          </div>
        </div>
        <div className="fr-overview-seal" aria-hidden="true"><span>◇</span><small>FROSTFALL REALMS</small></div>
      </div>

      <div className="fr-overview-stats" aria-label="Current world overview metrics">
        <div className="fr-overview-stat"><BookOpen aria-hidden="true" size={19}/><strong>{summary.entries.toLocaleString()}</strong><span>Codex entries</span></div>
        <div className="fr-overview-stat"><Layers3 aria-hidden="true" size={19}/><strong>{summary.categories.toLocaleString()}</strong><span>Lore categories</span></div>
        <div className="fr-overview-stat"><ScrollText aria-hidden="true" size={19}/><strong>{summary.manuscripts.toLocaleString()}</strong><span>Manuscripts</span></div>
        <div className="fr-overview-stat"><ShieldCheck aria-hidden="true" size={19}/><strong>{summary.integrityIssues.toLocaleString()}</strong><span>Integrity findings</span></div>
      </div>

      <div className="fr-overview-heading"><div><span className="fr-overview-small">YOUR WORKSPACE</span><h2>Continue building</h2></div><span className="fr-overview-subtle">Explore the tools for your current world</span></div>
      <div className="fr-overview-modules">
        {modules.map(({ key, title, subtitle, icon: Icon, tone }) => (
          <button type="button" key={key} className={`fr-overview-module fr-overview-module-${tone}`} onClick={key === "codex" ? onCodex : () => onOpen(key)}>
            <span className="fr-overview-module-icon"><Icon size={21} strokeWidth={1.8}/></span>
            <span><strong>{title}</strong><small>{subtitle}</small></span>
            <ChevronRight size={18} className="fr-overview-module-arrow" aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className="fr-overview-lower">
        <section className="fr-overview-panel" aria-labelledby="fr-recent-heading">
          <div className="fr-overview-panel-head"><div><span className="fr-overview-small">WORLD ACTIVITY</span><h2 id="fr-recent-heading">Recently edited lore</h2></div>
            <button type="button" onClick={onCodex}>All entries <ArrowUpRight size={15}/></button></div>
          {summary.recent.length ? <div className="fr-overview-recent">
            {summary.recent.map((article) => <button type="button" key={article.id} onClick={() => onArticle(article.id)}>
              <span className="fr-overview-recent-icon"><BookOpen size={18}/></span>
              <span className="fr-overview-recent-text"><strong>{article.title || "Untitled entry"}</strong><small>{article.category || "Codex"} · {article.updatedAt ? new Date(article.updatedAt).toLocaleDateString() : "Recently edited"}</small></span>
              <ArrowUpRight size={16} aria-hidden="true"/>
            </button>)}
          </div> : <div className="fr-overview-empty"><BookOpen size={25} aria-hidden="true" />
              <strong>No entries in this world yet</strong>
              <p>Codex entries belong to individual worlds. Entries in other accounts or worlds do not appear here.</p>
              {canEdit && <button type="button" onClick={onCreate}>Create the first entry <ArrowUpRight size={14}/></button>}
            </div>}
        </section>
        <section className="fr-overview-panel" aria-labelledby="fr-writing-heading">
          <div className="fr-overview-panel-head"><div><span className="fr-overview-small">WRITING & CANON</span><h2 id="fr-writing-heading">Author's desk</h2></div></div>
          <div className="fr-overview-work-summary"><div><BookText size={20}/><span><strong>{summary.manuscripts} manuscripts</strong><small>{summary.words.toLocaleString()} recorded Codex words</small></span></div>
            <div><ShieldCheck size={20}/><span><strong>{summary.integrityIssues ? `${summary.integrityIssues} findings to review` : "No reported integrity findings"}</strong><small>Current world · review your canon</small></span></div>
            <div><Globe2 size={20}/><span><strong>{statusLabel}</strong><small>Save status for the active world</small></span></div>
          </div>
          <button type="button" className="fr-overview-desk-link" onClick={() => onOpen("novel")}>Open Manuscripts <ArrowUpRight size={16}/></button>
        </section>
      </div>
    </section>
  );
}
