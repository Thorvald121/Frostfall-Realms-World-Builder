"use client";

import React from "react";
import { THEMES } from "@/lib/themes";
import { CATEGORIES, ERAS, FONT_SIZES, DEFAULT_SETTINGS, FEATURE_MODULES, formatKey } from "@/lib/domain/categories";

/**
 * SettingsPanel — Appearance / World / Account settings.
 *
 * Extracted from FrostfallRealms.jsx renderSettings.
 * All state is owned by the parent; this component receives props.
 */
export function SettingsPanel({
  theme,
  settings,
  setSettings,
  settingsTab,
  setSettingsTab,
  isMobile,
  articles,
  archived,
  manuscripts,
  setArticles,
  setArchived,
  setManuscripts,
  activeWorld,
  user,
  setShowConfirm,
  setView,
  avatarFileRef,
  uploadPortrait,
  supabase,
  formatYear,
  ta,
  tBtnS,
  tBtnP,
  Ornament,
  S,
}) {
  return (
    <div>
      <div style={{ marginTop: 24, marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1, display: "flex", alignItems: "center", gap: 10 }}>⚙ Settings</h2>
        <p style={{ fontSize: 13, color: theme.textMuted, marginTop: 6 }}>Configure your Frostfall Realms experience.</p>
      </div>
      <Ornament width={300} />

      {/* Settings tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 28, marginTop: 20 }}>
        {[
          { id: "appearance", icon: "🎨", label: "Appearance" },
          { id: "world", icon: "🌍", label: "World Settings" },
          { id: "api_keys", icon: "🔑", label: "API Keys" },
          { id: "account", icon: "👤", label: "Account" },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setSettingsTab(tab.id)}
            style={{ background: settingsTab === tab.id ? theme.accentBg : "transparent", border: "1px solid " + (settingsTab === tab.id ? theme.accent + "40" : theme.border), borderRadius: 8, padding: "10px 20px", color: settingsTab === tab.id ? theme.accent : theme.textMuted, fontSize: 13, fontWeight: settingsTab === tab.id ? 600 : 400, cursor: "pointer", fontFamily: "'Cinzel', serif", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s" }}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* === APPEARANCE TAB === */}
      {settingsTab === "appearance" && (
        <div style={{ maxWidth: 640 }}>
          {/* Theme Selection */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>Theme</h3>
            <p style={{ fontSize: 12, color: theme.textDim, margin: "0 0 16px" }}>Choose the visual atmosphere for your workspace.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {Object.entries(THEMES).map(([tid, t]) => {
                const isActive = settings.theme === tid;
                return (
                  <div key={tid} onClick={() => setSettings((p) => ({ ...p, theme: tid }))}
                    style={{ borderRadius: 10, cursor: "pointer", border: "2px solid " + (isActive ? theme.accent : theme.border), overflow: "hidden", transition: "all 0.2s", background: t.deepBg || t.cardBg }}>
                    {/* Mini UI preview */}
                    <div style={{ height: 52, background: t.rootBg, display: "flex", overflow: "hidden", position: "relative" }}>
                      {/* Sidebar mock */}
                      <div style={{ width: 40, height: "100%", background: t.sidebarBg, borderRight: "1px solid " + t.border, flexShrink: 0 }} />
                      {/* Content mock */}
                      <div style={{ flex: 1, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                        {/* Topbar mock */}
                        <div style={{ height: 6, width: "60%", borderRadius: 2, background: t.accent, opacity: 0.8 }} />
                        {/* Text lines mock */}
                        <div style={{ height: 3, width: "90%", borderRadius: 1, background: t.text, opacity: 0.25 }} />
                        <div style={{ height: 3, width: "75%", borderRadius: 1, background: t.text, opacity: 0.15 }} />
                        <div style={{ height: 3, width: "55%", borderRadius: 1, background: t.text, opacity: 0.15 }} />
                      </div>
                    </div>
                    {/* Color swatch strip */}
                    <div style={{ display: "flex", height: 6 }}>
                      <div style={{ flex: 2, background: t.deepBg }} />
                      <div style={{ flex: 2, background: t.surface }} />
                      <div style={{ flex: 1, background: t.border }} />
                      <div style={{ flex: 2, background: t.accent }} />
                      <div style={{ flex: 1, background: t.textDim }} />
                    </div>
                    {/* Label */}
                    <div style={{ padding: "10px 14px 12px" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? theme.accent : theme.text, fontFamily: "'Cinzel', serif" }}>{t.name}</div>
                      <div style={{ fontSize: 10, color: theme.textDim, marginTop: 2, lineHeight: 1.4 }}>{t.desc}</div>
                      {isActive && <div style={{ fontSize: 10, color: theme.accent, marginTop: 6, fontWeight: 600 }}>✓ Active</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* UI Scale */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>Interface Scale</h3>
            <p style={{ fontSize: 12, color: theme.textDim, margin: "0 0 16px" }}>Adjust the overall size of the interface.</p>
            <div style={{ display: "flex", gap: 8 }}>
              {[{ id: "compact", label: "Compact", sample: "Aa" }, { id: "default", label: "Default", sample: "Aa" }, { id: "large", label: "Large", sample: "Aa" }].map((s) => (
                <button key={s.id} onClick={() => setSettings((p) => ({ ...p, fontSize: s.id }))}
                  style={{ flex: 1, padding: "14px 16px", borderRadius: 8, cursor: "pointer", border: "1px solid " + (settings.fontSize === s.id ? theme.accent + "50" : theme.border), background: settings.fontSize === s.id ? theme.accentBg : "transparent", color: settings.fontSize === s.id ? theme.accent : theme.textMuted, textAlign: "center", fontFamily: "inherit", transition: "all 0.2s" }}>
                  <div style={{ fontSize: Math.round(20 * FONT_SIZES[s.id]), fontFamily: "'Cinzel', serif", marginBottom: 4 }}>{s.sample}</div>
                  <div style={{ fontSize: 11 }}>{s.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Editor settings note */}
          <div style={{ background: theme.accentBg, border: "1px solid " + theme.accent + "30", borderRadius: 8, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }} aria-hidden="true">⚙</span>
            <div>
              <div style={{ fontSize: 12, color: theme.text, fontWeight: 500 }}>Editor font and size settings have moved</div>
              <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>Open a scene in the Novel Writing tool and click <b>⚙ Editor</b> in the toolbar to configure font family and size.</div>
            </div>
          </div>
        </div>
      )}

      {/* === WORLD SETTINGS TAB === */}
      {settingsTab === "world" && (
        <div style={{ maxWidth: 640 }}>
          {/* Module Toggles */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>Category Modules</h3>
            <p style={{ fontSize: 12, color: theme.textDim, margin: "0 0 16px" }}>Toggle categories on or off to simplify your sidebar. Disabled categories are hidden from navigation but their data is preserved.</p>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
              {Object.entries(CATEGORIES).map(([cid, cat]) => {
                const isDisabled = settings.disabledCategories.includes(cid);
                const count = articles.filter((a) => a.category === cid).length;
                return (
                  <div key={cid} onClick={() => setSettings((p) => ({ ...p, disabledCategories: isDisabled ? p.disabledCategories.filter((c) => c !== cid) : [...p.disabledCategories, cid] }))}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 8, cursor: "pointer", border: "1px solid " + (isDisabled ? theme.border : cat.color + "40"), background: isDisabled ? "transparent" : cat.color + "08", opacity: isDisabled ? 0.5 : 1, transition: "all 0.2s" }}>
                    <div style={{ width: 36, height: 20, borderRadius: 10, background: isDisabled ? theme.border : cat.color, position: "relative", transition: "all 0.2s", flexShrink: 0 }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: isDisabled ? 2 : 18, transition: "all 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                    </div>
                    <span style={{ fontSize: 16 }}>{cat.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: isDisabled ? theme.textDim : theme.text }}>{cat.label}</div>
                      {count > 0 && <div style={{ fontSize: 10, color: theme.textDim }}>{count} entries</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Feature Module Toggles */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>Feature Modules</h3>
            <p style={{ fontSize: 12, color: theme.textDim, margin: "0 0 16px" }}>Toggle tool modules on or off to simplify your sidebar. Disabled features are hidden from navigation but no data is lost.</p>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
              {FEATURE_MODULES.map((feat) => {
                const isDisabled = (settings.disabledFeatures || []).includes(feat.id);
                return (
                  <div key={feat.id} onClick={() => setSettings((p) => ({ ...p, disabledFeatures: isDisabled ? (p.disabledFeatures || []).filter((f) => f !== feat.id) : [...(p.disabledFeatures || []), feat.id] }))}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 8, cursor: "pointer", border: "1px solid " + (isDisabled ? theme.border : theme.accent + "40"), background: isDisabled ? "transparent" : theme.accent + "08", opacity: isDisabled ? 0.5 : 1, transition: "all 0.2s" }}>
                    <div style={{ width: 36, height: 20, borderRadius: 10, background: isDisabled ? theme.border : theme.accent, position: "relative", transition: "all 0.2s", flexShrink: 0 }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: isDisabled ? 2 : 18, transition: "all 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                    </div>
                    <span style={{ fontSize: 16 }}>{feat.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: isDisabled ? theme.textDim : theme.text }}>{feat.label}</div>
                      <div style={{ fontSize: 10, color: theme.textDim }}>{feat.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Integrity Sensitivity */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>Integrity Engine Sensitivity</h3>
            <p style={{ fontSize: 12, color: theme.textDim, margin: "0 0 16px" }}>Controls how aggressively the Truth Engine flags potential issues.</p>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { id: "strict", label: "Strict", desc: "Flag everything — temporal notes, orphans, all warnings", icon: "🔒" },
                { id: "balanced", label: "Balanced", desc: "Flag errors and warnings, timeline notes as info only", icon: "⚖" },
                { id: "relaxed", label: "Relaxed", desc: "Only flag hard errors — duplicate names, broken links", icon: "🔓" },
              ].map((lvl) => (
                <div key={lvl.id} onClick={() => setSettings((p) => ({ ...p, integritySensitivity: lvl.id }))}
                  style={{ flex: 1, padding: "14px 16px", borderRadius: 8, cursor: "pointer", border: "1px solid " + (settings.integritySensitivity === lvl.id ? theme.accent + "50" : theme.border), background: settings.integritySensitivity === lvl.id ? theme.accentBg : "transparent", transition: "all 0.2s", textAlign: "center" }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{lvl.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: settings.integritySensitivity === lvl.id ? theme.accent : theme.text, fontFamily: "'Cinzel', serif" }}>{lvl.label}</div>
                  <div style={{ fontSize: 10, color: theme.textDim, marginTop: 4, lineHeight: 1.4 }}>{lvl.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom Era Label */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>Time Period Label</h3>
            <p style={{ fontSize: 12, color: theme.textDim, margin: "0 0 16px" }}>Customize how years are displayed. The label combines with era names when defined.</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <input value={settings.eraLabel} onChange={(e) => setSettings((p) => ({ ...p, eraLabel: e.target.value }))}
                style={{ ...S.input, width: 180, background: theme.inputBg, border: "1px solid " + theme.border, color: theme.text }}
                placeholder="Year" />
              <span style={{ fontSize: 12, color: theme.textDim }}>Preview: <span style={{ color: theme.accent }}>{formatYear(2400)}</span></span>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
              {["Year", "Age", "Cycle", "Era", "Turn", "AR", "AE"].map((preset) => (
                <button key={preset} onClick={() => setSettings((p) => ({ ...p, eraLabel: preset }))}
                  style={{ background: settings.eraLabel === preset ? theme.accentBg : "transparent", border: "1px solid " + (settings.eraLabel === preset ? theme.accent + "40" : theme.border), borderRadius: 6, padding: "4px 12px", fontSize: 11, color: settings.eraLabel === preset ? theme.accent : theme.textMuted, cursor: "pointer", fontFamily: "inherit" }}>
                  {preset}
                </button>
              ))}
            </div>

            {/* Custom Era Ranges */}
            <h4 style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>Era Definitions</h4>
            <p style={{ fontSize: 11, color: theme.textDim, margin: "0 0 12px" }}>Define named eras with year ranges. Used in timeline display and year formatting. Leave empty to use defaults.</p>
            {(settings.customEras?.length > 0 ? settings.customEras : ERAS).map((era, i) => {
              const isCustom = settings.customEras?.length > 0;
              return (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                  <input style={{ ...S.input, flex: 1, padding: "6px 10px", fontSize: 11, background: theme.inputBg, border: "1px solid " + theme.border, color: theme.text }}
                    value={era.label || era.name || ""} placeholder="Era name..."
                    onChange={(e) => { const eras = [...(settings.customEras?.length > 0 ? settings.customEras : ERAS.map((e) => ({...e})))]; eras[i] = { ...eras[i], label: e.target.value, name: e.target.value }; setSettings((p) => ({ ...p, customEras: eras })); }} />
                  <input type="number" style={{ ...S.input, width: 70, padding: "6px 8px", fontSize: 11, background: theme.inputBg, border: "1px solid " + theme.border, color: theme.text, textAlign: "center" }}
                    value={era.start} placeholder="Start"
                    onChange={(e) => { const eras = [...(settings.customEras?.length > 0 ? settings.customEras : ERAS.map((e) => ({...e})))]; eras[i] = { ...eras[i], start: parseInt(e.target.value) || 0 }; setSettings((p) => ({ ...p, customEras: eras })); }} />
                  <span style={{ fontSize: 10, color: theme.textDim }}>to</span>
                  <input type="number" style={{ ...S.input, width: 70, padding: "6px 8px", fontSize: 11, background: theme.inputBg, border: "1px solid " + theme.border, color: theme.text, textAlign: "center" }}
                    value={era.end} placeholder="End"
                    onChange={(e) => { const eras = [...(settings.customEras?.length > 0 ? settings.customEras : ERAS.map((e) => ({...e})))]; eras[i] = { ...eras[i], end: parseInt(e.target.value) || 0 }; setSettings((p) => ({ ...p, customEras: eras })); }} />
                  <input type="color" value={era.color || theme.accent} style={{ width: 24, height: 24, border: "none", background: "none", cursor: "pointer", padding: 0 }}
                    onChange={(e) => { const eras = [...(settings.customEras?.length > 0 ? settings.customEras : ERAS.map((e) => ({...e})))]; eras[i] = { ...eras[i], color: e.target.value }; setSettings((p) => ({ ...p, customEras: eras })); }} />
                  {isCustom && <button onClick={() => { const eras = settings.customEras.filter((_, j) => j !== i); setSettings((p) => ({ ...p, customEras: eras })); }}
                    style={{ background: "none", border: "none", color: "#e07050", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>✕</button>}
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => { const eras = [...(settings.customEras?.length > 0 ? settings.customEras : ERAS.map((e) => ({...e}))), { id: "custom_" + Date.now(), label: "New Era", name: "New Era", start: 0, end: 1000, color: "#8ec8a0", bg: "rgba(142,200,160,0.06)" }]; setSettings((p) => ({ ...p, customEras: eras })); }}
                style={{ ...tBtnS, fontSize: 10, padding: "5px 12px", color: "#8ec8a0", borderColor: "rgba(142,200,160,0.3)" }}>+ Add Era</button>
              {settings.customEras?.length > 0 && (
                <button onClick={() => setSettings((p) => ({ ...p, customEras: [] }))}
                  style={{ ...tBtnS, fontSize: 10, padding: "5px 12px", color: theme.accent, borderColor: ta(theme.accent, 0.3) }}>Reset to Defaults</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* === API KEYS TAB === */}
      {settingsTab === "api_keys" && (
        <div style={{ maxWidth: 640 }}>
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>AI Provider</h3>
            <p style={{ fontSize: 12, color: theme.textDim, margin: "0 0 16px" }}>Choose which AI service to use for document import and other AI features. Keys are stored locally in your browser — never sent to our servers.</p>

            {/* Provider selector */}
            <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
              {[
                { id: "anthropic", icon: "🟣", label: "Claude", sub: "Anthropic" },
                { id: "openai", icon: "🟢", label: "ChatGPT", sub: "OpenAI" },
                { id: "google", icon: "🔵", label: "Gemini", sub: "Google" },
              ].map((p) => {
                const isActive = (settings.aiProvider || "anthropic") === p.id;
                const hasKey = settings.aiKeys?.[p.id]?.length > 10;
                return (
                  <div key={p.id} onClick={() => setSettings((s) => ({ ...s, aiProvider: p.id }))}
                    style={{
                      flex: "1 1 160px", padding: "16px 18px", borderRadius: 10, cursor: "pointer",
                      border: "2px solid " + (isActive ? theme.accent : theme.border),
                      background: isActive ? ta(theme.accent, 0.06) : ta(theme.surface, 0.4),
                      transition: "all 0.2s", position: "relative",
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 18 }}>{p.icon}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: isActive ? theme.accent : theme.text }}>{p.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: theme.textDim }}>{p.sub}</div>
                    {hasKey && (
                      <div style={{ position: "absolute", top: 8, right: 10, fontSize: 10, color: "#8ec8a0", fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#8ec8a0" }} /> Connected
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Key input for active provider */}
          {[
            { id: "anthropic", label: "Anthropic API Key", placeholder: "sk-ant-...", helpUrl: "https://console.anthropic.com/settings/keys", helpLabel: "Get your key from console.anthropic.com" },
            { id: "openai", label: "OpenAI API Key", placeholder: "sk-...", helpUrl: "https://platform.openai.com/api-keys", helpLabel: "Get your key from platform.openai.com" },
            { id: "google", label: "Google AI API Key", placeholder: "AIza...", helpUrl: "https://aistudio.google.com/app/apikey", helpLabel: "Get your key from aistudio.google.com" },
          ].filter((p) => p.id === (settings.aiProvider || "anthropic")).map((provider) => {
            const currentKey = settings.aiKeys?.[provider.id] || "";
            const masked = currentKey ? currentKey.slice(0, 8) + "•".repeat(Math.max(0, currentKey.length - 12)) + currentKey.slice(-4) : "";
            return (
              <div key={provider.id} style={{ marginBottom: 32 }}>
                <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>{provider.label}</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input
                    type="password"
                    value={currentKey}
                    onChange={(e) => setSettings((s) => ({
                      ...s,
                      aiKeys: { ...(s.aiKeys || {}), [provider.id]: e.target.value },
                    }))}
                    placeholder={provider.placeholder}
                    style={{ ...S.input, flex: 1, minWidth: 0, background: theme.inputBg, border: "1px solid " + theme.border, color: theme.text, fontFamily: "monospace", fontSize: 12, letterSpacing: 0.5, overflow: "hidden", textOverflow: "ellipsis" }}
                  />
                  {currentKey && (
                    <button onClick={() => setSettings((s) => ({
                      ...s,
                      aiKeys: { ...(s.aiKeys || {}), [provider.id]: "" },
                    }))} style={{ ...tBtnS, fontSize: 10, color: "#e07050", borderColor: "rgba(224,112,80,0.3)", padding: "8px 12px", whiteSpace: "nowrap" }}>
                      Remove
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: theme.textDim, lineHeight: 1.6, wordBreak: "break-word" }}>
                  {provider.helpLabel} → <a href={provider.helpUrl} target="_blank" rel="noopener noreferrer" style={{ color: theme.accent, textDecoration: "underline" }}>{provider.helpUrl.replace("https://", "")}</a>
                </div>
                {currentKey && (
                  <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(142,200,160,0.06)", border: "1px solid rgba(142,200,160,0.15)", borderRadius: 6, display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                    <span style={{ fontSize: 12 }}>✅</span>
                    <span style={{ fontSize: 11, color: "#8ec8a0", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{masked}</span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Security note */}
          <div style={{ padding: "16px 20px", background: ta(theme.surface, 0.6), border: "1px solid " + theme.border, borderRadius: 8, marginBottom: 32 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>🔒</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 4 }}>Your Keys Stay Local</div>
                <div style={{ fontSize: 11, color: theme.textDim, lineHeight: 1.6 }}>
                  API keys are stored in your browser's local storage only. They are sent directly to the AI provider's API when you use AI Import — they never pass through our servers. Clearing your browser data will remove stored keys.
                </div>
              </div>
            </div>
          </div>

          {/* Model selection */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>Model Preference</h3>
            <p style={{ fontSize: 12, color: theme.textDim, margin: "0 0 12px" }}>Choose which model to use. Faster models cost less but may be less accurate.</p>
            {(() => {
              const provId = settings.aiProvider || "anthropic";
              const models = {
                anthropic: [
                  { id: "claude-sonnet-5.1", label: "Claude Sonnet 5.1", desc: "Best balance of speed and quality" },
                  { id: "claude-opus-5.1", label: "Claude Opus 5.1", desc: "Fastest, most affordable" },
                ],
                openai: [
                  { id: "gpt-5.1", label: "GPT-5.1", desc: "Most capable, best quality" },
                  { id: "gpt-5.1-mini", label: "GPT-5.1 Mini", desc: "Faster, more affordable" },
                ],
                google: [
                  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", desc: "Fast and efficient" },
                  { id: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro", desc: "Most capable" },
                ],
              }[provId] || [];
              const currentModel = settings.aiModel?.[provId] || models[0]?.id;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {models.map((m) => (
                    <div key={m.id} onClick={() => setSettings((s) => ({
                      ...s,
                      aiModel: { ...(s.aiModel || {}), [provId]: m.id },
                    }))}
                      style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                        borderRadius: 8, cursor: "pointer",
                        border: "1px solid " + (currentModel === m.id ? ta(theme.accent, 0.4) : theme.border),
                        background: currentModel === m.id ? ta(theme.accent, 0.06) : "transparent",
                        transition: "all 0.15s",
                      }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: "50%",
                        border: "2px solid " + (currentModel === m.id ? theme.accent : theme.textDim),
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {currentModel === m.id && <div style={{ width: 8, height: 8, borderRadius: "50%", background: theme.accent }} />}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: currentModel === m.id ? theme.accent : theme.text }}>{m.label}</div>
                        <div style={{ fontSize: 11, color: theme.textDim }}>{m.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* === ACCOUNT TAB === */}
      {settingsTab === "account" && (
        <div style={{ maxWidth: 640 }}>
          {/* Author Profile */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>Author Profile</h3>
            <p style={{ fontSize: 12, color: theme.textDim, margin: "0 0 16px" }}>Your identity as it appears on exported manuscripts and shared content.</p>
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
              {/* Avatar */}
              <div style={{ flexShrink: 0 }}>
                <div style={{ width: 80, height: 80, borderRadius: "50%", border: "2px solid " + theme.border, background: theme.surface, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 8, cursor: "pointer" }}
                  onClick={() => avatarFileRef.current?.click()}>
                  {settings.avatarUrl ? (
                    <img src={settings.avatarUrl} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <span style={{ fontSize: 28, color: theme.textDim }}>👤</span>
                  )}
                </div>
                <input ref={avatarFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  if (file.size > 2000000) { alert("Image must be under 2MB"); return; }
                  if (supabase && user) {
                    const url = await uploadPortrait(user.id, file);
                    if (url) { setSettings((p) => ({ ...p, avatarUrl: url })); e.target.value = ""; return; }
                  }
                  const reader = new FileReader();
                  reader.onload = (ev) => { setSettings((p) => ({ ...p, avatarUrl: ev.target.result })); };
                  reader.readAsDataURL(file);
                  e.target.value = "";
                }} />
                <button onClick={() => avatarFileRef.current?.click()} style={{ ...tBtnS, fontSize: 9, padding: "4px 8px", width: 80, textAlign: "center" }}>Upload</button>
                {settings.avatarUrl && <button onClick={() => setSettings((p) => ({ ...p, avatarUrl: "" }))} style={{ background: "none", border: "none", fontSize: 9, color: "#e07050", cursor: "pointer", width: 80, textAlign: "center", marginTop: 4 }}>Remove</button>}
              </div>
              {/* Name + info */}
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Author / Display Name</label>
                <input value={settings.authorName} onChange={(e) => setSettings((p) => ({ ...p, authorName: e.target.value }))}
                  style={{ ...S.input, background: theme.inputBg, border: "1px solid " + theme.border, color: theme.text }}
                  placeholder="Enter your author name..." />
                <div style={{ fontSize: 11, color: theme.textDim, marginTop: 8 }}>This name will appear on manuscript title pages when you export and in collaboration features.</div>
              </div>
            </div>
          </div>

          {/* Data Export */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>Data Export</h3>
            <p style={{ fontSize: 12, color: theme.textDim, margin: "0 0 16px" }}>Download a complete backup of your world data as JSON. Includes all articles, archived entries, and metadata.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => {
                const data = { exportFormat: "frostfall-realms-v2", exportedAt: new Date().toISOString(), worldName: activeWorld?.name, worldDescription: activeWorld?.description, settings, articles, archived, manuscripts, stats: { articles: articles.length, archived: archived.length, categories: Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, articles.filter((a) => a.category === k).length])) } };
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = (activeWorld?.name || "frostfall").replace(/\s+/g, "_").toLowerCase() + "_backup_" + new Date().toISOString().slice(0, 10) + ".json"; a.click(); URL.revokeObjectURL(url);
              }} style={{ ...tBtnP, fontSize: 12, padding: "10px 20px" }}>
                📥 Export World Data (JSON)
              </button>
              <button onClick={() => {
                const data = { exportFormat: "frostfall-realms-v2", exportedAt: new Date().toISOString(), worldName: activeWorld?.name, articles, archived };
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = (activeWorld?.name || "frostfall").replace(/\s+/g, "_").toLowerCase() + "_articles_" + new Date().toISOString().slice(0, 10) + ".json"; a.click(); URL.revokeObjectURL(url);
              }} style={{ ...tBtnS, fontSize: 12, color: theme.textMuted, borderColor: theme.border }}>
                📋 Export Articles Only
              </button>
            </div>
            <div style={{ marginTop: 12, padding: "10px 14px", background: theme.surface, border: "1px solid " + theme.border, borderRadius: 6, fontSize: 11, color: theme.textDim, lineHeight: 1.5 }}>
              <strong style={{ color: theme.textMuted }}>Export includes:</strong> {articles.length} articles, {archived.length} archived, {manuscripts.length} manuscript{manuscripts.length !== 1 ? "s" : ""}, all settings and metadata.
            </div>
          </div>

          {/* Reset / Danger Zone */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#e07050", margin: "0 0 6px", letterSpacing: 0.5 }}>Danger Zone</h3>
            <p style={{ fontSize: 12, color: theme.textDim, margin: "0 0 16px" }}>Irreversible actions. Please export your data before proceeding.</p>
            <div style={{ padding: "16px 20px", border: "1px solid rgba(224,112,80,0.3)", borderRadius: 8, background: "rgba(224,112,80,0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e07050" }}>Reset Settings to Default</div>
                  <div style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>Revert all appearance, world, and account settings. Does not delete articles.</div>
                </div>
                <button onClick={() => setShowConfirm({ title: "Reset Settings?", message: "This will reset all settings to their defaults. Your articles and manuscripts will not be affected.", onConfirm: () => { setSettings(DEFAULT_SETTINGS); setShowConfirm(null); } })}
                  style={{ ...tBtnS, fontSize: 11, color: "#e07050", borderColor: "rgba(224,112,80,0.3)", padding: "6px 14px", whiteSpace: "nowrap" }}>
                  Reset Settings
                </button>
              </div>
              <div style={{ height: 1, background: "rgba(224,112,80,0.15)", margin: "12px 0" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e07050" }}>Delete All World Data</div>
                  <div style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>Permanently delete all articles, manuscripts, and settings. This cannot be undone.</div>
                </div>
                <button onClick={() => setShowConfirm({ title: "Delete Everything?", message: "This will permanently delete ALL " + articles.length + " articles, " + archived.length + " archived entries, and " + manuscripts.length + " manuscripts. This CANNOT be undone. Please export first.", onConfirm: () => { setArticles([]); setArchived([]); setManuscripts([]); setSettings(DEFAULT_SETTINGS); setView("dashboard"); setShowConfirm(null); } })}
                  style={{ ...tBtnS, fontSize: 11, color: "#e07050", borderColor: "rgba(224,112,80,0.3)", padding: "6px 14px", whiteSpace: "nowrap" }}>
                  Delete All Data
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}