"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export default function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authView, setAuthView] = useState("login"); // login | register | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Check session on mount
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => listener?.subscription?.unsubscribe();
  }, []);

  const handleLogin = async () => {
    setError(""); setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setSubmitting(false);
  };

  const handleRegister = async () => {
    setError(""); setSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { display_name: displayName || email.split("@")[0] } },
    });
    if (error) setError(error.message);
    else setSuccess("Check your email for a confirmation link!");
    setSubmitting(false);
  };

  const handleForgot = async () => {
    setError(""); setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) setError(error.message);
    else setSuccess("Password reset email sent!");
    setSubmitting(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const handleOAuth = async (provider) => {
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  };

  // If no Supabase configured, skip auth (local dev mode)
  if (!supabase) return children({ user: null, onLogout: () => {} });
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(170deg, #0a0e1a 0%, #111827 40%, #0f1420 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: "#f0c040" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>◈</div>
        <p style={{ fontFamily: "'Cinzel', 'Palatino Linotype', serif", fontSize: 16, letterSpacing: 2 }}>LOADING…</p>
      </div>
    </div>
  );

  // Authenticated — render app
  if (user) return children({ user, onLogout: handleLogout });

  // Auth form styles
  const S = {
    input: { width: "100%", background: "#0d1117", border: "1px solid #1e2a3a", borderRadius: 6, padding: "11px 14px", color: "#d4c9a8", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box" },
    btn: { width: "100%", background: "linear-gradient(135deg, #f0c040 0%, #d4a020 100%)", color: "#0a0e1a", border: "none", borderRadius: 6, padding: "12px 24px", fontSize: 14, fontWeight: 700, fontFamily: "'Cinzel', serif", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" },
    btnSecondary: { width: "100%", background: "transparent", color: "#8899aa", border: "1px solid #1e2a3a", borderRadius: 6, padding: "11px 24px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
    link: { fontSize: 12, color: "#f0c040", cursor: "pointer", background: "none", border: "none", fontFamily: "inherit", textDecoration: "underline" },
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(170deg, #0a0e1a 0%, #111827 40%, #0f1420 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif" }}>
      <div style={{ width: 400, maxWidth: "90vw" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, color: "#f0c040", marginBottom: 8 }}>◈</div>
          <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 28, color: "#e8dcc8", margin: "0 0 4px", letterSpacing: 3 }}>FROSTFALL REALMS</h1>
          <p style={{ fontSize: 13, color: "#556677", letterSpacing: 1 }}>Worldbuilding Engine</p>
        </div>

        <div style={{ background: "linear-gradient(135deg, #111827 0%, #0d1117 100%)", border: "1px solid #1e2a3a", borderRadius: 12, padding: "28px 32px" }}>
          {/* Tabs */}
          <div style={{ display: "flex", marginBottom: 24, borderBottom: "1px solid #1a2435" }}>
            {[["login", "Sign In"], ["register", "Create Account"]].map(([id, label]) => (
              <button key={id} onClick={() => { setAuthView(id); setError(""); setSuccess(""); }}
                style={{ flex: 1, padding: "10px 0", background: "none", border: "none", borderBottom: authView === id ? "2px solid #f0c040" : "2px solid transparent", color: authView === id ? "#f0c040" : "#556677", fontFamily: "'Cinzel', serif", fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: 1 }}>
                {label}
              </button>
            ))}
          </div>

          {error && <div style={{ background: "rgba(224,112,80,0.1)", border: "1px solid rgba(224,112,80,0.3)", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#e07050" }}>{error}</div>}
          {success && <div style={{ background: "rgba(142,200,160,0.1)", border: "1px solid rgba(142,200,160,0.3)", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#8ec8a0" }}>{success}</div>}

          {authView === "forgot" ? (
            <>
              <p style={{ fontSize: 13, color: "#8899aa", marginBottom: 16, lineHeight: 1.5 }}>Enter your email and we'll send a password reset link.</p>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Email</label>
                <input style={S.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <button style={{ ...S.btn, opacity: submitting ? 0.6 : 1 }} onClick={handleForgot} disabled={submitting}>Send Reset Link</button>
              <div style={{ textAlign: "center", marginTop: 16 }}><button style={S.link} onClick={() => setAuthView("login")}>← Back to Sign In</button></div>
            </>
          ) : (
            <>
              {authView === "register" && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Display Name</label>
                  <input style={S.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your worldbuilder name" />
                </div>
              )}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Email</label>
                <input style={S.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" onKeyDown={(e) => e.key === "Enter" && (authView === "login" ? handleLogin() : handleRegister())} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Password</label>
                <input style={S.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === "Enter" && (authView === "login" ? handleLogin() : handleRegister())} />
              </div>
              <button style={{ ...S.btn, opacity: submitting ? 0.6 : 1 }} onClick={authView === "login" ? handleLogin : handleRegister} disabled={submitting}>
                {authView === "login" ? "Sign In" : "Create Account"}
              </button>

              {authView === "login" && (
                <div style={{ textAlign: "center", marginTop: 12 }}>
                  <button style={S.link} onClick={() => { setAuthView("forgot"); setError(""); setSuccess(""); }}>Forgot password?</button>
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
                <div style={{ flex: 1, height: 1, background: "#1e2a3a" }} />
                <span style={{ fontSize: 10, color: "#445566", letterSpacing: 1 }}>OR</span>
                <div style={{ flex: 1, height: 1, background: "#1e2a3a" }} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button style={S.btnSecondary} onClick={() => handleOAuth("google")}>
                  <span>🔵</span> Continue with Google
                </button>
                <button style={S.btnSecondary} onClick={() => handleOAuth("github")}>
                  <span>⚫</span> Continue with GitHub
                </button>
              </div>
            </>
          )}
        </div>

        <p style={{ textAlign: "center", fontSize: 10, color: "#333d4d", marginTop: 24, letterSpacing: 1 }}>FROSTFALL REALMS © {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}