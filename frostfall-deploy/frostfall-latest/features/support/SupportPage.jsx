"use client";
import { useState, useEffect, useCallback } from "react";
import { submitSupportTicket, fetchMyTickets } from "@/lib/supabase";

/**
 * SupportPage — In-app support ticket system
 * Allows users to submit bugs, feature requests, questions, complaints, and suggestions.
 * Tickets stored in Supabase with status tracking.
 */

const TICKET_CATEGORIES = [
  { id: "bug", label: "Bug Report", icon: "🐛", color: "#e07050", desc: "Something isn't working correctly" },
  { id: "feature", label: "Feature Request", icon: "✨", color: "#c084fc", desc: "Suggest a new feature or improvement" },
  { id: "question", label: "Question", icon: "❓", color: "#7ec8e3", desc: "Need help understanding something" },
  { id: "suggestion", label: "Suggestion", icon: "💡", color: "#f0c040", desc: "General feedback or ideas" },
  { id: "complaint", label: "Complaint", icon: "⚠", color: "#e07050", desc: "Something frustrating or disappointing" },
];

const STATUS_LABELS = {
  open: { label: "Open", color: "#f0c040" },
  in_progress: { label: "In Progress", color: "#7ec8e3" },
  resolved: { label: "Resolved", color: "#8ec8a0" },
  closed: { label: "Closed", color: "#556677" },
};

export function SupportPage({ theme, ta, tBtnP, tBtnS, S, Ornament, isMobile }) {
  const [tab, setTab] = useState("submit"); // "submit" | "history"
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);

  const loadTickets = useCallback(async () => {
    const data = await fetchMyTickets();
    setTickets(data);
    setTicketsLoaded(true);
  }, []);

  useEffect(() => {
    if (tab === "history" && !ticketsLoaded) loadTickets();
  }, [tab, ticketsLoaded, loadTickets]);

  const handleSubmit = async () => {
    if (!category || !subject.trim() || !description.trim()) return;
    setSubmitting(true);
    setSubmitResult(null);
    const result = await submitSupportTicket(category, subject.trim(), description.trim());
    setSubmitting(false);
    if (result.success) {
      setSubmitResult({ type: "success", message: "Ticket submitted! We'll review it soon." });
      setCategory("");
      setSubject("");
      setDescription("");
      setTicketsLoaded(false); // refresh history on next view
    } else {
      setSubmitResult({ type: "error", message: result.error || "Failed to submit" });
    }
  };

  return (
    <div style={{ marginTop: 24, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1 }}>📬 Support & Feedback</h2>
        <Ornament width={120} />
      </div>
      <p style={{ fontSize: 13, color: theme.textDim, marginBottom: 20, lineHeight: 1.6 }}>
        Found a bug? Have an idea? We'd love to hear from you. Submit a ticket and we'll review it.
      </p>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
        {[
          { id: "submit", label: "Submit Ticket", icon: "✎" },
          { id: "history", label: "My Tickets", icon: "📋", count: tickets.length || undefined },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ fontSize: 12, padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontFamily: "'Cinzel', serif", fontWeight: tab === t.id ? 600 : 400, letterSpacing: 0.5, border: "1px solid " + (tab === t.id ? ta(theme.accent, 0.4) : theme.border), background: tab === t.id ? ta(theme.accent, 0.1) : "transparent", color: tab === t.id ? theme.accent : theme.textMuted, transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6 }}>
            <span>{t.icon}</span> {t.label}
            {t.count != null && <span style={{ fontSize: 10, opacity: 0.7 }}>({t.count})</span>}
          </button>
        ))}
      </div>

      {/* SUBMIT TAB */}
      {tab === "submit" && (
        <div>
          {/* Category picker */}
          <label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>Category</label>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
            {TICKET_CATEGORIES.map((cat) => (
              <div key={cat.id} onClick={() => setCategory(cat.id)}
                style={{ padding: "12px 14px", borderRadius: 8, cursor: "pointer", border: "1px solid " + (category === cat.id ? cat.color + "60" : theme.border), background: category === cat.id ? cat.color + "12" : "transparent", transition: "all 0.2s" }}
                onMouseEnter={(e) => { if (category !== cat.id) e.currentTarget.style.background = ta(theme.surface, 0.6); }}
                onMouseLeave={(e) => { if (category !== cat.id) e.currentTarget.style.background = "transparent"; }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{cat.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: category === cat.id ? cat.color : theme.text }}>{cat.label}</div>
                    <div style={{ fontSize: 10, color: theme.textDim, marginTop: 2 }}>{cat.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Subject */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Subject</label>
            <input style={S.input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary of your issue or idea..." maxLength={200} />
          </div>

          {/* Description */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Description</label>
            <textarea style={{ ...S.textarea, minHeight: 140 }} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue, feature, or suggestion in detail. Include steps to reproduce for bugs..." />
          </div>

          {/* Submit result */}
          {submitResult && (
            <div style={{ padding: "10px 16px", borderRadius: 8, marginBottom: 16, background: submitResult.type === "success" ? "rgba(142,200,160,0.1)" : "rgba(224,112,80,0.1)", border: "1px solid " + (submitResult.type === "success" ? "rgba(142,200,160,0.3)" : "rgba(224,112,80,0.3)"), color: submitResult.type === "success" ? "#8ec8a0" : "#e07050", fontSize: 13 }}>
              {submitResult.type === "success" ? "✓ " : "✕ "}{submitResult.message}
            </div>
          )}

          {/* Submit button */}
          <button onClick={handleSubmit} disabled={submitting || !category || !subject.trim() || !description.trim()}
            style={{ ...tBtnP, opacity: (submitting || !category || !subject.trim() || !description.trim()) ? 0.4 : 1, display: "flex", alignItems: "center", gap: 8 }}>
            {submitting ? "Submitting..." : "Submit Ticket"}
          </button>
        </div>
      )}

      {/* HISTORY TAB */}
      {tab === "history" && (
        <div>
          {!ticketsLoaded ? (
            <div style={{ textAlign: "center", padding: 40, color: theme.textDim }}>Loading tickets...</div>
          ) : tickets.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: theme.textDim }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <p>No tickets submitted yet.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tickets.map((t) => {
                const cat = TICKET_CATEGORIES.find((c) => c.id === t.category) || TICKET_CATEGORIES[0];
                const st = STATUS_LABELS[t.status] || STATUS_LABELS.open;
                return (
                  <div key={t.id} style={{ padding: "14px 18px", background: ta(theme.surface, 0.5), borderTop: "1px solid " + theme.divider, borderRight: "1px solid " + theme.divider, borderBottom: "1px solid " + theme.divider, borderLeft: "3px solid " + cat.color, borderRadius: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 14 }}>{cat.icon}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: theme.text, flex: 1 }}>{t.subject}</span>
                      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: st.color + "20", color: st.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{st.label}</span>
                    </div>
                    <p style={{ fontSize: 12, color: theme.textMuted, margin: "0 0 6px", lineHeight: 1.5 }}>{t.description.slice(0, 200)}{t.description.length > 200 ? "..." : ""}</p>
                    <div style={{ fontSize: 10, color: theme.textDim }}>
                      Submitted {new Date(t.created_at).toLocaleDateString()} · {cat.label}
                    </div>
                    {t.admin_notes && (
                      <div style={{ marginTop: 8, padding: "8px 12px", background: ta("#7ec8e3", 0.06), borderRadius: 6, border: "1px solid rgba(126,200,227,0.15)" }}>
                        <div style={{ fontSize: 10, color: "#7ec8e3", fontWeight: 600, marginBottom: 4 }}>Admin Response:</div>
                        <div style={{ fontSize: 12, color: theme.textMuted, lineHeight: 1.5 }}>{t.admin_notes}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SupportPage;