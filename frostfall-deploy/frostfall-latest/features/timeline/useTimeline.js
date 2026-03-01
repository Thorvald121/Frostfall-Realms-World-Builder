"use client";

import { useState, useMemo, useCallback } from "react";
import { SWIM_LANE_ORDER } from "@/lib/domain/categories";

/**
 * useTimeline — all timeline state, computations, and callbacks.
 * Extracted from FrostfallRealms.jsx.
 */
export function useTimeline(articles) {
  const [tlZoom, setTlZoom] = useState(3);
  const [tlSelected, setTlSelected] = useState(null);
  const [tlPanelOpen, setTlPanelOpen] = useState(false);

  const tlData = useMemo(() => {
    const items = articles.filter((a) => a.temporal && a.temporal.active_start != null);
    const lanes = {};
    SWIM_LANE_ORDER.forEach((cat) => {
      const catItems = items.filter((a) => a.category === cat);
      if (catItems.length > 0) lanes[cat] = catItems.sort((a, b) => a.temporal.active_start - b.temporal.active_start);
    });
    return { items, lanes };
  }, [articles]);

  const tlRange = useMemo(() => {
    if (tlData.items.length === 0) return { min: -500, max: 5000 };
    const starts = tlData.items.map((a) => a.temporal.active_start);
    const ends = tlData.items.map((a) => a.temporal.active_end ?? a.temporal.active_start);
    const min = Math.min(...starts), max = Math.max(...ends);
    const pad = Math.max((max - min) * 0.05, 200);
    return { min: min - pad, max: max + pad };
  }, [tlData]);

  const tlPxPerYear = useMemo(() => [0.02, 0.05, 0.12, 0.3, 0.6, 1.2, 2.5][tlZoom] || 0.3, [tlZoom]);
  const yearToX = useCallback((year) => (year - tlRange.min) * tlPxPerYear, [tlRange, tlPxPerYear]);
  const tlTotalWidth = useMemo(() => (tlRange.max - tlRange.min) * tlPxPerYear, [tlRange, tlPxPerYear]);

  const tlTicks = useMemo(() => {
    const range = tlRange.max - tlRange.min;
    const idealCount = tlTotalWidth / 120;
    const rawStep = range / idealCount;
    const magnitudes = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
    const step = magnitudes.find((m) => m >= rawStep) || 5000;
    const ticks = [];
    const start = Math.ceil(tlRange.min / step) * step;
    for (let y = start; y <= tlRange.max; y += step) ticks.push(y);
    return { ticks, step };
  }, [tlRange, tlTotalWidth]);

  const tlSelectArticle = useCallback((a) => { setTlSelected(a); setTlPanelOpen(true); }, []);
  const tlClosePanel = useCallback(() => { setTlPanelOpen(false); setTimeout(() => setTlSelected(null), 300); }, []);

  const tlLaneHeights = useMemo(() => {
    const heights = {};
    SWIM_LANE_ORDER.forEach((cat) => {
      if (!tlData.lanes[cat]) return;
      const entries = tlData.lanes[cat];
      const placed = [];
      entries.forEach((a) => {
        const x = yearToX(a.temporal.active_start);
        const hasEnd = a.temporal.active_end != null && a.temporal.active_end !== a.temporal.active_start;
        const xEnd = hasEnd ? yearToX(a.temporal.active_end) : x + 28;
        let row = 0;
        while (placed.some((p) => p.row === row && p.xEnd > x - 4 && p.x < xEnd + 4)) row++;
        placed.push({ id: a.id, x, xEnd, row });
      });
      const maxRow = Math.max(0, ...placed.map((p) => p.row));
      heights[cat] = 40 + maxRow * 30;
    });
    return heights;
  }, [tlData, yearToX]);

  return {
    tlZoom, setTlZoom, tlSelected, setTlSelected,
    tlPanelOpen, setTlPanelOpen, tlData, tlRange,
    tlPxPerYear, yearToX, tlTotalWidth, tlTicks,
    tlSelectArticle, tlClosePanel, tlLaneHeights,
  };
}