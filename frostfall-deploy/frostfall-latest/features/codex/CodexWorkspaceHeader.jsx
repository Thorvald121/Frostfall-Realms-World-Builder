"use client";

import { BookOpen, Boxes, LayoutGrid, List, Network, Search, ShieldAlert, SlidersHorizontal } from "lucide-react";
import EntryTypeMenu from "@/components/ui/EntryTypeMenu";
import { summarizeCodexWorkspace } from "@/lib/domain/codexMetrics";
import styles from "./CodexWorkspaceHeader.module.css";

/** Workspace presentation only: existing Codex model, filters and CRUD stay authoritative. */
export function CodexWorkspaceHeader({
  worldName,
  articles,
  categories,
  disabledCategories,
  categoryFilter,
  onCategoryFilter,
  results,
  search,
  onSearch,
  sort,
  onSort,
  viewMode,
  onViewMode,
  bulkMode,
  onBulkToggle,
  onCanon,
  onCreate,
  canWrite,
}) {
  const enabled = Object.entries(categories).filter(([id]) => !disabledCategories.includes(id));
  const summary = summarizeCodexWorkspace({ articles, categories, disabledCategories });
  const statCards = [
    { icon: BookOpen, label: "Codex entries", value: summary.entries },
    { icon: Boxes, label: "Populated categories", value: summary.categories },
    { icon: Network, label: "Entries with links", value: summary.linked },
    { icon: ShieldAlert, label: "Flagged entries", value: summary.flagged },
  ];
  return (
    <section className={styles.root} aria-label="Codex Studio workspace">
      <div className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>THE WORLD / {worldName || "WORLD"}</div>
          <h1 className={styles.title}>Codex Studio</h1>
          <p className={styles.subtitle}>Catalog the people, places, histories, and details that shape your world.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onCanon}>
            <ShieldAlert aria-hidden="true" size={15} /> Canon Studio
          </button>
          {canWrite && <EntryTypeMenu categories={categories} disabledCategories={disabledCategories}
            contextKey={worldName} onSelect={onCreate} buttonClassName="fr-new-entry-btn" />}
        </div>
      </div>
      <div className={styles.stats}>
        {statCards.map(({ icon: Icon, label, value }) => (
          <div className={styles.stat} key={label}>
            <Icon aria-hidden="true" size={16} className={styles.statIcon} />
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className={styles.catalog}>
        <div className={styles.searchRow}>
          <div className={styles.finder}>
            <label htmlFor="fr-codex-search"><Search aria-hidden="true" size={16} /> Search this world</label>
            <input id="fr-codex-search" type="search" value={search} onChange={(e) => onSearch(e.target.value)}
              placeholder="Titles, descriptions, lore, tags..." autoComplete="off" />
          </div>
          <div className={styles.sortWrap}>
            <label htmlFor="fr-codex-sort"><SlidersHorizontal aria-hidden="true" size={15} /> Sort</label>
            <select id="fr-codex-sort" value={sort} onChange={(e) => onSort(e.target.value)}>
              <option value="recent">Recently updated</option>
              <option value="alpha_asc">Title: A to Z</option>
              <option value="alpha_desc">Title: Z to A</option>
              <option value="oldest">Oldest first</option>
              <option value="words">Word count</option>
              <option value="era">Chronological</option>
              <option value="category">Category</option>
            </select>
          </div>
          <div className={styles.toggleGroup} role="group" aria-label="Codex display style">
            <button type="button" aria-label="List view" aria-pressed={viewMode === "list"} className={viewMode === "list" ? styles.activeToggle : ""} onClick={() => onViewMode("list")}><List size={18} /></button>
            <button type="button" aria-label="Grid view" aria-pressed={viewMode === "grid"} className={viewMode === "grid" ? styles.activeToggle : ""} onClick={() => onViewMode("grid")}><LayoutGrid size={18} /></button>
          </div>
          {canWrite && <button type="button" aria-pressed={bulkMode} className={`${styles.secondary} ${bulkMode ? styles.activeToggle : ""}`} onClick={onBulkToggle}>
            {bulkMode ? "Done selecting" : "Select entries"}
          </button>}
        </div>
        <div className={styles.categoryRow} role="group" aria-label="Filter entries by category">
          <button type="button" className={categoryFilter === "all" ? styles.selectedCategory : ""}
            aria-pressed={categoryFilter === "all"} onClick={() => onCategoryFilter("all")}>All entries <span>{summary.entries}</span></button>
          {enabled.map(([id, category]) => {
            const count = summary.categoryCounts[id] || 0;
            return <button type="button" key={id} aria-pressed={categoryFilter === id}
              className={categoryFilter === id ? styles.selectedCategory : ""} onClick={() => onCategoryFilter(id)}
              style={{ "--category-color": category.color }}>
              <span className={styles.categoryMark} aria-hidden="true" style={{ background: category.color }} />
              {category.label} <span>{count}</span>
            </button>;
          })}
        </div>
        <p role="status" className={styles.resultLabel}>
          {results} {results === 1 ? "entry" : "entries"} in view
          {search.trim() ? ` matching “${search.trim()}”` : ""}
        </p>
      </div>
    </section>
  );
}

export function CodexEmptyState({ hasEntries, onClear, onCreate, canWrite, categories, disabledCategories, contextKey }) {
  return (
    <div className={styles.empty} role="status">
      <BookOpen aria-hidden="true" size={30} />
      <h2>{hasEntries ? "No entries match your filters" : "Your Codex is ready to grow"}</h2>
      <p>{hasEntries ? "Try clearing your search, category, tag, and reference filters." : "Create your first entry to begin connecting this world’s lore, events, and characters."}</p>
      <div className={styles.emptyActions}>
        {hasEntries && <button type="button" className={styles.secondary} onClick={onClear}>Clear all filters</button>}
        {!hasEntries && canWrite && <EntryTypeMenu categories={categories} disabledCategories={disabledCategories} contextKey={contextKey} onSelect={onCreate} label="Create your first entry" />}
      </div>
    </div>
  );
}
