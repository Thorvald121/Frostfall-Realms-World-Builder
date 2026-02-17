"use client";

import React, { useEffect, useMemo, useState } from "react";
import ThemeSelect from "@/components/ThemeSelect";
import { applyThemeToRoot, loadThemeKey, saveThemeKey } from "@/lib/themes";

// ✅ CHANGE THIS IMPORT IF YOUR PROJECT USES A DIFFERENT SUPABASE CLIENT PATH
// Common patterns:
//   - import { supabase } from "@/lib/supabaseClient";
//   - import { createClient } from "@/utils/supabase/client";
//   - import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@/lib/supabase/client";

export default function AuthGate({ children }) {
  const supabase = useMemo(() => {
    try {
      return createClient();
    } catch (e) {
      // If createClient import/path is wrong, UI still loads and shows a helpful error.
      return null;
    }
  }, []);

  // Theme state (Option A)
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
  const [fatal, setFatal] = useState("");

  // Load session + subscribe
  useEffect(() => {
    let unsub = null;

    async function boot() {
      if (!supabase) {
        setFatal(
          "Supabase client not initialized. Check the import in components/AuthGate.jsx (createClient path)."
        );
        return;
      }

      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        setSession(data?.session ?? null);

        const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
          setSession(newSession ?? null);
        });

        unsub = sub?.subscription;
      } catch (err) {
        setFatal(err?.message || "Failed to initialize authentication.");
      }
    }

    boot();

    return () => {
      try {
        unsub?.unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, [supabase]);

  async function onSubmit(e) {
    e.preventDefault();
    setMessage("");

    if (!supabase) {
      setFatal("Supabase client not initialized (bad createClient import/path).");
      return;
    }

    const cleanEmail = (email || "").trim();

    if (!cleanEmail) {
      setMessage("Enter your email.");
      return;
    }
    if (!password || password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    try {
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });
        if (error) throw error;

        setMessage(
          "Account created. If email confirmation is enabled, check your inbox before signing in."
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) throw error;
        setMessage("");
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

  // If authenticated, pass through.
  if (session) {
    return (
      <div style={{ minHeight: "100vh" }}>
        {/* Top-right controls */}
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
              fontFamily: "var(--uiFont)",
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

  // Auth UI
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
      {/* Theme selector */}
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
        {/* Left: Brand / Info */}
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
              fontFamily: "var(--displayFont)",
              fontSize: 28,
              letterSpacing: 0.6,
              marginBottom: 8,
              color: "var(--text)",
            }}
          >
            Frostfall Realms
          </div>

          <div style={{ color: "var(--textMuted)", lineHeight: 1.5, fontSize: 14 }}>
            Theme-driven UI is now global. You can change themes here, and the rest of the
            application will inherit colors from CSS tokens.
          </div>

          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 16,
              border: "1px solid var(--border)",
              background: "color-mix(in srgb, var(--surface) 70%, transparent)",
            }}
          >
            <div style={{ fontFamily: "var(--uiFont)", fontWeight: 600, marginBottom: 6 }}>
              Theme notes
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--textMuted)", lineHeight: 1.6 }}>
              <li>Dark Arcane + Midnight Blue are tuned for readability.</li>
              <li>Parchment Light keeps ink-on-paper contrast consistent.</li>
              <li>Frostfall Ice + Emberforge add two more usable palettes.</li>
            </ul>
          </div>

          {fatal ? (
            <div
              style={{
                marginTop: 18,
                color: "var(--text)",
                background: "rgba(220, 38, 38, 0.15)",
                border: "1px solid rgba(220, 38, 38, 0.35)",
                padding: 12,
                borderRadius: 14,
                lineHeight: 1.45,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Configuration issue</div>
              <div style={{ color: "var(--textMuted)" }}>{fatal}</div>
              <div style={{ marginTop: 10, color: "var(--textMuted)" }}>
                Fix: update the Supabase import at the top of <code>components/AuthGate.jsx</code>.
              </div>
            </div>
          ) : null}
        </div>

        {/* Right: Auth Card */}
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
                fontFamily: "var(--uiFont)",
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
                fontFamily: "var(--uiFont)",
                fontWeight: 650,
              }}
            >
              Create account
            </button>
          </div>

          <div style={{ marginBottom: 10, color: "var(--textMuted)", fontSize: 13 }}>
            {authMode === "signup"
              ? "Create an account to access your worlds and archives."
              : "Welcome back. Sign in to continue."}
          </div>

          <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--textMuted)" }}>Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                placeholder="you@domain.com"
                style={{
                  padding: "11px 12px",
                  fontSize: 14,
                  fontFamily: "var(--uiFont)",
                }}
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
                style={{
                  padding: "11px 12px",
                  fontSize: 14,
                  fontFamily: "var(--uiFont)",
                }}
              />
            </label>

            {message ? (
              <div
                style={{
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

            <button
              type="submit"
              disabled={busy || !!fatal}
              style={{
                marginTop: 2,
                background: "var(--accent)",
                color: "black",
                border: "none",
                borderRadius: 14,
                padding: "11px 12px",
                fontFamily: "var(--uiFont)",
                fontSize: 14,
                fontWeight: 800,
                cursor: busy || !!fatal ? "not-allowed" : "pointer",
                opacity: busy || !!fatal ? 0.7 : 1,
              }}
            >
              {busy ? "Working…" : authMode === "signup" ? "Create account" : "Sign in"}
            </button>

            <div style={{ marginTop: 10, fontSize: 12, color: "var(--textDim)", lineHeight: 1.5 }}>
              Password-based auth shown here for simplicity. If your project uses magic links,
              OAuth, or email confirmation settings, this UI still works — Supabase behavior will
              follow your project settings.
            </div>
          </form>
        </div>
      </div>

      {/* Mobile layout fallback */}
      <style>{`
        @media (max-width: 880px) {
          .ff-auth-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
