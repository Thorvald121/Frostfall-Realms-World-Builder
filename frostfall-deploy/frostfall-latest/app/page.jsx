"use client";
import { Component } from "react";
import AuthGate from "../components/AuthGate";
import FrostfallRealms from "../components/FrostfallRealms";

// Error boundary — catches runtime crashes in FrostfallRealms and shows
// the real error instead of silently unmounting (which causes the login loop)
class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Frostfall app crash:", error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh",
          background: "#0a0e1a",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "monospace", padding: 40,
        }}>
          <div style={{ maxWidth: 700, width: "100%" }}>
            <div style={{ color: "#f0c040", fontSize: 24, marginBottom: 16 }}>◈ Application Error</div>
            <div style={{ color: "#e07050", fontSize: 14, marginBottom: 8, fontWeight: 700 }}>
              {this.state.error?.message || "Unknown error"}
            </div>
            <pre style={{
              color: "#8899aa", fontSize: 11, lineHeight: 1.6,
              background: "#111827", padding: 20, borderRadius: 8,
              overflow: "auto", maxHeight: 400,
              border: "1px solid #1e2a3a",
            }}>
              {this.state.error?.stack}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              style={{
                marginTop: 20, padding: "10px 24px",
                background: "#f0c040", color: "#0a0e1a",
                border: "none", borderRadius: 6, cursor: "pointer",
                fontWeight: 700, fontSize: 13,
              }}>
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Home() {
  return (
    <AppErrorBoundary>
      <AuthGate>
        {({ user, onLogout }) => (
          <FrostfallRealms user={user} onLogout={onLogout} />
        )}
      </AuthGate>
    </AppErrorBoundary>
  );
}