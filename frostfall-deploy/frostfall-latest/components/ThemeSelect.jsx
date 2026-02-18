"use client";

import React from "react";
import { THEMES } from "../lib/themes";

export default function ThemeSelect({ value, onChange, compact = false }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      title="Theme"
      style={{
        background: "var(--inputBg)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: compact ? "6px 10px" : "8px 12px",
        fontFamily: "var(--uiFont, system-ui)",
        fontSize: compact ? 12 : 14,
        cursor: "pointer",
      }}
    >
      {Object.entries(THEMES).map(([k, t]) => (
        <option key={k} value={k}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
