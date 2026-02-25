"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * useIntegrity (Frontend Hook)
 *
 * Phase A2: build temporal graph once per articles change and inject into
 * checkArticleIntegrity(...) so domain graph isn't rebuilt per-article.
 *
 * Phase B UI-surface: ensure temporal_propagated (info-level) is still surfaced
 * in the Integrity view, otherwise propagation is invisible.
 *
 * Signature:
 *   useIntegrity(articles, settings, { detectConflicts, checkArticleIntegrity, buildTemporalGraph })
 */
export function useIntegrity(articles, settings, deps) {
  const { detectConflicts, checkArticleIntegrity, buildTemporalGraph } = deps || {};

  if (typeof detectConflicts !== "function" || typeof checkArticleIntegrity !== "function") {
    throw new Error(
      "useIntegrity requires deps: { detectConflicts: fn, checkArticleIntegrity: fn, buildTemporalGraph: fn }"
    );
  }

  const [dismissedConflicts, setDismissedConflicts] = useState(new Set());
  const [dismissedTemporals, setDismissedTemporals] = useState(new Set());
  const [integrityGate, setIntegrityGate] = useState(null);

  const INTEGRITY_PAGE = 20;
  const [integrityVisible, setIntegrityVisible] = useState(INTEGRITY_PAGE);

  const allConflicts = useMemo(() => detectConflicts(articles), [articles, detectConflicts]);

  const visibleConflicts = useMemo(
    () => (allConflicts || []).filter((c) => !dismissedConflicts.has(c.id)),
    [allConflicts, dismissedConflicts]
  );

  const conflictsFor = useCallback(
    (id) => (allConflicts || []).filter((c) => c.sourceId === id && !dismissedConflicts.has(c.id)),
    [allConflicts, dismissedConflicts]
  );

  // Keep old-callsite compatibility: filterBySensitivity(warnings) -> warningsFiltered
  const filterBySensitivity = useCallback(
    (warnings) => {
      if (!Array.isArray(warnings)) return warnings;

      if (settings?.integritySensitivity === "strict") return warnings;

      if (settings?.integritySensitivity === "relaxed") {
        return warnings.filter((w) => w?.severity === "error" || w?.type === "duplicate");
      }

      return warnings;
    },
    [settings?.integritySensitivity]
  );

  // Phase A2: build temporal graph once
  const temporalGraph = useMemo(() => {
    try {
      return typeof buildTemporalGraph === "function" ? buildTemporalGraph(articles || []) : null;
    } catch (e) {
      console.warn("[useIntegrity] buildTemporalGraph failed; continuing without graph.", e);
      return null;
    }
  }, [articles, buildTemporalGraph]);

  // Preferred call: checkArticleIntegrity(data, allArticles, graph, excludeId)
  const runIntegrityCheck = useCallback(
    (article) => {
      try {
        // If caller provided an injected graph, use it; integrity.js still supports building internally too.
        return checkArticleIntegrity(article, articles, temporalGraph, article?.id);
      } catch (e) {
        console.warn("[useIntegrity] checkArticleIntegrity threw; treating as no issues.", e);
        return [];
      }
    },
    [checkArticleIntegrity, articles, temporalGraph]
  );

  const globalIntegrity = useMemo(() => {
    const articlesWithIssues = [];

    (articles || []).forEach((a) => {
      const issues = filterBySensitivity(runIntegrityCheck(a)) || [];

      // Surface errors + warnings, and ALSO temporal_propagated (info) so Phase B is visible.
      const surfaced = issues.filter((w) => {
        if (!w) return false;
        if (dismissedTemporals.has(w.id)) return false; // optional future use if warnings get ids
        if (w.severity === "error" || w.severity === "warning") return true;
        if (w.type === "temporal_propagated") return true;
        return false;
      });

      if (surfaced.length > 0) articlesWithIssues.push({ article: a, issues: surfaced });
    });

    return articlesWithIssues;
  }, [articles, filterBySensitivity, runIntegrityCheck, dismissedTemporals]);

  const totalIntegrityIssues =
    visibleConflicts.length + globalIntegrity.reduce((t, a) => t + (a?.issues?.length || 0), 0);

  return {
    allConflicts,
    visibleConflicts,
    conflictsFor,
    filterBySensitivity,

    globalIntegrity,
    totalIntegrityIssues,

    dismissedConflicts,
    setDismissedConflicts,

    dismissedTemporals,
    setDismissedTemporals,

    integrityGate,
    setIntegrityGate,

    integrityVisible,
    setIntegrityVisible,
    INTEGRITY_PAGE,

    // Expose for debugging
    temporalGraph,
  };
}
