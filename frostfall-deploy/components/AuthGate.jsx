"use client";

import React, { useEffect, useState } from "react";
import ThemeSelect from "./ThemeSelect";
import { applyThemeToRoot, loadThemeKey, saveThemeKey } from "../lib/themes";
import { supabase } from "../lib/supabase";

export default function AuthGate({ children }) {
  // Theme (Option A)
  const [themeKey, setThemeKey] = useState(() => loadThemeKey());

  useEffect(() => {
    applyThemeToRoot(themeKey);
    saveThemeKey(themeKey);
  }, [themeKey]);

  // Auth state
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // If env vars missing, supabase.js exports null.
    if (!supabase) {
      setMessage(
        "Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing)."
      );
      return;
    }

    let sub;

    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!error) setSession(data?.session ?? null);

      const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
        setSession(newSession ?? null);
      });
      sub = listener?.subscription;
    })();

    return () => {
      try {
        sub?.unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setMessage("");

    if (!supabase) {
      setMessage("Supabase is not configured.");
      return;
    }

    const cleanEmail = (email || "").trim();
    if (!cleanEmail) return setMessage("Enter your email.");
    if (!password || password.length < 6) return setMessage("Password must be at least 6 characters.");

    setBusy(true);
    try {
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({ email: cleanEmail, password });
        if (error) throw error;
        setMessage("Account created. Check your email if confirmations are enabled.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
      }
    } catch (err) {
      setMessage(err?.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (err) {
      setMessage(err?.message || "Sign out failed.");
    } finally {
      setBusy(false);
    }
  }

  // Authenticated → show app
  if (session) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <div
          style={{
            position: "fixed",
            top: 14,
            right: 14,
            zIndex: 50,
            display: "flex",
            gap: 10,
            alignItems: "center",
            background: "var(--topBarBg)",
            border: "1px solid var(--border)",
            padding: "10px 12px",
            borderRadius: 14,
            backdropFilter: "blur(10px)",
          }}
        >
          <ThemeSelect value={themeKey} onChange={setThemeKey} compact />
          <button
            onClick={onSignOut}
            disabled={busy}
            style={{
              background: "var(--accentBg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "6px 10px",
              cursor: busy ? "not-allowed" : "pointer",
              fontFamily: "var(--uiFont, system-ui)",
              fontSize: 12,
            }}
          >
            Sign out
          </button>
        </div>

        {children}
      </div>
    );
  }

  // Login / Signup UI
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 22,
        background: "var(--rootBg)",
        color: "var(--text)",
        position: "relative",
      }}
    >
      <div style={{ position: "fixed", top: 14, right: 14, zIndex: 50 }}>
        <ThemeSelect value={themeKey} onChange={setThemeKey} compact />
      </div>

      <div
        className="ff-auth-grid"
        style={{
          width: "min(980px, 100%)",
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: 18,
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            background: "var(--cardBg)",
            border: "1px solid var(--border)",
            borderRadius: 18,
            padding: 22,
            backdropFilter: "blur(10px)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--displayFont, ui-serif)",
              fontSize: 28,
              letterSpacing: 0.6,
              marginBottom: 8,
            }}
          >
            Frostfall Realms
          </div>

          <div style={{ color: "var(--textMuted)", lineHeight: 1.5, fontSize: 14 }}>
            Select a theme that’s readable, then sign in. The theme is applied globally via CSS tokens.
          </div>

          {message ? (
            <div
              style={{
                marginTop: 16,
                background: "color-mix(in srgb, var(--accentBg) 35%, transparent)",
                border: "1px solid var(--border)",
                padding: "10px 12px",
                borderRadius: 14,
                color: "var(--textMuted)",
                lineHeight: 1.4,
                fontSize: 13,
              }}
            >
              {message}
            </div>
          ) : null}
        </div>

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 18,
            padding: 22,
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          }}
        >
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => {
                setAuthMode("signin");
                setMessage("");
              }}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid var(--border)",
                cursor: "pointer",
                background: authMode === "signin" ? "var(--accentBg)" : "var(--inputBg)",
                color: "var(--text)",
                fontFamily: "var(--uiFont, system-ui)",
                fontWeight: 650,
              }}
            >
              Sign in
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode("signup");
                setMessage("");
              }}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid var(--border)",
                cursor: "pointer",
                background: authMode === "signup" ? "var(--accentBg)" : "var(--inputBg)",
                color: "var(--text)",
                fontFamily: "var(--uiFont, system-ui)",
                fontWeight: 650,
              }}
            >
              Create account
            </button>
          </div>

          <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--textMuted)" }}>Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                placeholder="you@domain.com"
                style={{ padding: "11px 12px", fontSize: 14, fontFamily: "var(--uiFont, system-ui)" }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--textMuted)" }}>Password</span>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                placeholder="••••••••"
                style={{ padding: "11px 12px", fontSize: 14, fontFamily: "var(--uiFont, system-ui)" }}
              />
            </label>

            <button
              type="submit"
              disabled={busy || !supabase}
              style={{
                background: "var(--accent)",
                color: "black",
                border: "none",
                borderRadius: 14,
                padding: "11px 12px",
                fontFamily: "var(--uiFont, system-ui)",
                fontSize: 14,
                fontWeight: 800,
                cursor: busy || !supabase ? "not-allowed" : "pointer",
                opacity: busy || !supabase ? 0.7 : 1,
              }}
            >
              {busy ? "Working…" : authMode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>
        </div>
      </div>

      <style>{`
        @media (max-width: 880px) {
          .ff-auth-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
