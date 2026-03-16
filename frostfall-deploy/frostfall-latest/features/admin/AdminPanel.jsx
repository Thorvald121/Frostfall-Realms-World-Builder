"use client";
import { useState, useEffect, useCallback } from "react";
import { fetchAllTickets, updateTicket, fetchAllAdmins, grantAdminRole, revokeAdminRole } from "@/lib/supabase";

const TICKET_CATEGORIES = {
  bug:        { label: "Bug Report",      icon: "🐛", color: "#e07050" },
  feature:    { label: "Feature Request", icon: "✨", color: "#c084fc" },
  question:   { label: "Question",        icon: "❓", color: "#7ec8e3" },
  suggestion: { label: "Suggestion",      icon: "💡", color: "#f0c040" },
  complaint:  { label: "Complaint",       icon: "⚠",  color: "#e07050" },
};

const STATUS_OPTIONS = [
  { value: "open",        label: "Open",        color: "#f0c040" },
  { value: "in_progress", label: "In Progress", color: "#7ec8e3" },
  { value: "resolved",    label: "Resolved",    color: "#8ec8a0" },
  { value: "closed",      label: "Closed",      color: "#556677" },
];

const ADMIN_ROLES = [
  { value: "super_admin",   label: "Super Admin",   desc: "Full access — tickets, users, grant/revoke roles" },
  { value: "support_admin", label: "Support Admin", desc: "Tickets only — read all, respond, change status" },
  { value: "tech_admin",    label: "Tech Admin",    desc: "Read-only — tickets and activity logs" },
];

export function AdminPanel({ theme, ta, tBtnP, tBtnS, S, Ornament, adminRole, isMobile }) {
  const [tab, setTab] = useState("tickets");

  // ── Tickets state ──
  const [tickets, setTickets]             = useState([]);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [filterStatus, setFilterStatus]   = useState("all");
  const [filterCat, setFilterCat]         = useState("all");
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [draftNote, setDraftNote]         = useState("");
  const [draftStatus, setDraftStatus]     = useState("");
  const [saving, setSaving]               = useState(false);
  const [saveMsg, setSaveMsg]             = useState(null);

  // ── Admin users state ──
  const [admins, setAdmins]               = useState([]);
  const [adminsLoaded, setAdminsLoaded]   = useState(false);
  const [newEmail, setNewEmail]           = useState("");
  const [newRole, setNewRole]             = useState("support_admin");
  const [newNotes, setNewNotes]           = useState("");
  const [granting, setGranting]           = useState(false);
  const [grantMsg, setGrantMsg]           = useState(null);

  const isSuperAdmin = adminRole === "super_admin";

  // ── Load tickets ──
  const loadTickets = useCallback(async () => {
    setTicketsLoading(true);
    const { tickets: t, error } = await fetchAllTickets();
    setTickets(t);
    setTicketsLoaded(true);
    setTicketsLoading(false);
    if (error) console.error("Admin fetch tickets:", error);
  }, []);

  useEffect(() => { if (tab === "tickets" && !ticketsLoaded) loadTickets(); }, [tab, ticketsLoaded, loadTickets]);

  // ── Load admins ──
  const loadAdmins = useCallback(async () => {
    const { admins: a } = await fetchAllAdmins();
    setAdmins(a);
    setAdminsLoaded(true);
  }, []);

  useEffect(() => { if (tab === "admins" && !adminsLoaded) loadAdmins(); }, [tab, adminsLoaded, loadAdmins]);

  // ── Open ticket ──
  const openTicket = (ticket) => {
    setSelectedTicket(ticket);
    setDraftNote(ticket.admin_notes || "");
    setDraftStatus(ticket.status || "open");
    setSaveMsg(null);
  };

  // ── Save response ──
  const handleSave = async () => {
    if (!selectedTicket) return;
    setSaving(true);
    const result = await updateTicket(selectedTicket.id, {
      status: draftStatus,
      adminNotes: draftNote,
    });
    setSaving(false);
    if (result.success) {
      setTickets((prev) => prev.map((t) =>
        t.id === selectedTicket.id
          ? { ...t, status: draftStatus, admin_notes: draftNote }
          : t
      ));
      setSelectedTicket((prev) => ({ ...prev, status: draftStatus, admin_notes: draftNote }));
      setSaveMsg("✓ Saved");
      setTimeout(() => setSaveMsg(null), 2500);
    } else {
      setSaveMsg("✕ Failed: " + result.error);
    }
  };

  // ── Grant admin ──
  const handleGrant = async () => {
    if (!newEmail.trim()) return;
    setGranting(true);
    const result = await grantAdminRole(newEmail.trim(), newRole, newNotes.trim());
    setGranting(false);
    if (result.success) {
      setGrantMsg("✓ Access granted. The user must be signed up already.");
      setNewEmail(""); setNewNotes("");
      setAdminsLoaded(false); // trigger reload
    } else {
      setGrantMsg("✕ Failed: " + result.error);
    }
    setTimeout(() => setGrantMsg(null), 4000);
  };

  // ── Revoke admin ──
  const handleRevoke = async (adminId, email) => {
    if (!confirm(`Revoke admin access for ${email}?`)) return;
    const ok = await revokeAdminRole(adminId);
    if (ok) setAdmins((prev) => prev.filter((a) => a.id !== adminId));
  };

  // ── Filtered tickets ──
  const filtered = tickets.filter((t) => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterCat !== "all" && t.category !== filterCat) return false;
    return true;
  });

  const statusCounts = STATUS_OPTIONS.reduce((acc, s) => {
    acc[s.value] = tickets.filter((t) => t.status === s.value).length;
    return acc;
  }, {});

  // ── Style helpers ──
  const tabBtn = (id) => ({
    fontSize: 12, padding: "8px 18px", borderRadius: 8, cursor: "pointer",
    fontFamily: "'Cinzel', serif", fontWeight: tab === id ? 600 : 400, letterSpacing: 0.5,
    border: "1px solid " + (tab === id ? ta(theme.accent, 0.4) : theme.border),
    background: tab === id ? ta(theme.accent, 0.1) : "transparent",
    color: tab === id ? theme.accent : theme.textMuted, transition: "all 0.15s",
  });

  const statusBadge = (status) => {
    const s = STATUS_OPTIONS.find((o) => o.value === status) || STATUS_OPTIONS[0];
    return (
      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: s.color + "20", color: s.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {s.label}
      </span>
    );
  };

  return (
    <div style={{ marginTop: 24, maxWidth: 1000 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1 }}>
          🔐 Admin Panel
        </h2>
        <Ornament width={100} />
        <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 10, background: "rgba(240,192,64,0.12)", color: "#f0c040", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {adminRole?.replace("_", " ") || "admin"}
        </span>
      </div>
      <p style={{ fontSize: 12, color: theme.textDim, marginBottom: 20 }}>
        Visible only to authorized staff. This panel is not accessible to regular users.
      </p>

      {/* Summary stat strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 24 }}>
        {[
          { label: "Total", value: tickets.length, color: theme.accent },
          ...STATUS_OPTIONS.map((s) => ({ label: s.label, value: statusCounts[s.value] || 0, color: s.color })),
        ].map((s) => (
          <div key={s.label} style={{ padding: "12px 16px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.border, borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "'Cinzel', serif" }}>{s.value}</div>
            <div style={{ fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
        <button onClick={() => setTab("tickets")} style={tabBtn("tickets")}>📋 Support Tickets</button>
        {isSuperAdmin && <button onClick={() => setTab("admins")} style={tabBtn("admins")}>👤 Admin Users</button>}
      </div>

      {/* ══════════════════════════════════
          TICKETS TAB
      ══════════════════════════════════ */}
      {tab === "tickets" && (
        <div style={{ display: "flex", gap: 16, flexDirection: isMobile ? "column" : "row" }}>
          {/* Ticket list */}
          <div style={{ flex: selectedTicket ? "0 0 340px" : 1 }}>
            {/* Filters */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                style={{ ...S.input, fontSize: 11, padding: "5px 10px", width: "auto" }}>
                <option value="all">All Statuses</option>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label} ({statusCounts[s.value] || 0})</option>)}
              </select>
              <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
                style={{ ...S.input, fontSize: 11, padding: "5px 10px", width: "auto" }}>
                <option value="all">All Categories</option>
                {Object.entries(TICKET_CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.icon} {c.label}</option>)}
              </select>
              <button onClick={() => { setTicketsLoaded(false); loadTickets(); }}
                style={{ ...tBtnS, fontSize: 11, padding: "5px 12px" }}>↺ Refresh</button>
            </div>

            {ticketsLoading && <div style={{ padding: 20, color: theme.textDim, textAlign: "center" }}>Loading…</div>}

            {!ticketsLoading && filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: theme.textDim }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
                <p>No tickets match the current filters.</p>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filtered.map((t) => {
                const cat = TICKET_CATEGORIES[t.category] || TICKET_CATEGORIES.question;
                const isSelected = selectedTicket?.id === t.id;
                return (
                  <div key={t.id} onClick={() => openTicket(t)}
                    style={{
                      padding: "12px 16px", borderRadius: 8, cursor: "pointer",
                      background: isSelected ? ta(theme.accent, 0.08) : ta(theme.surface, 0.5),
                      borderTop: "1px solid " + (isSelected ? ta(theme.accent, 0.3) : theme.divider),
                      borderRight: "1px solid " + (isSelected ? ta(theme.accent, 0.3) : theme.divider),
                      borderBottom: "1px solid " + (isSelected ? ta(theme.accent, 0.3) : theme.divider),
                      borderLeft: "3px solid " + cat.color,
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = ta(theme.surface, 0.8); }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ta(theme.surface, 0.5); }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 13 }}>{cat.icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: theme.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</span>
                      {statusBadge(t.status)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, color: theme.textDim }}>{t.display_name || t.user_email?.split("@")[0] || "User"}</span>
                      <span style={{ fontSize: 9, color: ta(theme.textDim, 0.5) }}>·</span>
                      <span style={{ fontSize: 10, color: theme.textDim }}>{new Date(t.created_at).toLocaleDateString()}</span>
                      {t.admin_notes && <span style={{ fontSize: 9, color: "#7ec8e3", marginLeft: "auto" }}>💬 Replied</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ticket detail */}
          {selectedTicket && (() => {
            const cat = TICKET_CATEGORIES[selectedTicket.category] || TICKET_CATEGORIES.question;
            return (
              <div style={{ flex: 1, background: ta(theme.surface, 0.4), border: "1px solid " + theme.border, borderRadius: 10, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                {/* Close */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 16 }}>{cat.icon}</span>
                      <span style={{ fontSize: 10, color: cat.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{cat.label}</span>
                      {statusBadge(selectedTicket.status)}
                    </div>
                    <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: theme.text, margin: 0 }}>{selectedTicket.subject}</h3>
                    <div style={{ fontSize: 11, color: theme.textDim, marginTop: 4 }}>
                      From: <strong style={{ color: theme.textMuted }}>{selectedTicket.display_name || "User"}</strong>
                      {selectedTicket.user_email && <span> · {selectedTicket.user_email}</span>}
                      <span> · {new Date(selectedTicket.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <button onClick={() => setSelectedTicket(null)}
                    style={{ background: "none", border: "none", color: theme.textDim, fontSize: 18, cursor: "pointer", flexShrink: 0, padding: "0 4px" }}>×</button>
                </div>

                {/* User message */}
                <div style={{ padding: "14px 16px", background: ta(theme.deepBg, 0.5), borderRadius: 8, border: "1px solid " + theme.divider }}>
                  <div style={{ fontSize: 10, color: theme.textDim, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>User Message</div>
                  <p style={{ fontSize: 13, color: theme.textMuted, margin: 0, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{selectedTicket.description}</p>
                </div>

                {/* Status control */}
                <div>
                  <label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Status</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {STATUS_OPTIONS.map((s) => (
                      <button key={s.value} onClick={() => setDraftStatus(s.value)}
                        style={{ fontSize: 11, padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: draftStatus === s.value ? 700 : 400, background: draftStatus === s.value ? s.color + "20" : "transparent", border: "1px solid " + (draftStatus === s.value ? s.color + "60" : theme.border), color: draftStatus === s.value ? s.color : theme.textMuted, transition: "all 0.15s" }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Admin response */}
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>
                    Response / Admin Notes
                    <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>— visible to the user in their Tickets tab</span>
                  </label>
                  <textarea
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                    placeholder="Write a response to the user, or internal notes…"
                    style={{ ...S.textarea, minHeight: 120 }}
                  />
                </div>

                {/* Save */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={handleSave} disabled={saving}
                    style={{ ...tBtnP, fontSize: 12, padding: "8px 24px", opacity: saving ? 0.6 : 1 }}>
                    {saving ? "Saving…" : "Save Response"}
                  </button>
                  {saveMsg && (
                    <span style={{ fontSize: 12, color: saveMsg.startsWith("✓") ? "#8ec8a0" : "#e07050" }}>{saveMsg}</span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ══════════════════════════════════
          ADMIN USERS TAB (super_admin only)
      ══════════════════════════════════ */}
      {tab === "admins" && isSuperAdmin && (
        <div style={{ maxWidth: 680 }}>
          {/* Grant access */}
          <div style={{ padding: "20px 24px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.border, borderRadius: 10, marginBottom: 24 }}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: theme.text, fontWeight: 600, marginBottom: 14 }}>Grant Admin Access</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 2, minWidth: 200 }}>
                <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>Email Address</label>
                <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="staff@example.com"
                  style={{ ...S.input, fontSize: 13 }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>Role</label>
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
                  style={{ ...S.input, fontSize: 12, padding: "8px 10px" }}>
                  {ADMIN_ROLES.filter((r) => r.value !== "super_admin").map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>Notes (optional)</label>
                <input value={newNotes} onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="e.g. Support team"
                  style={{ ...S.input, fontSize: 12 }} />
              </div>
              <button onClick={handleGrant} disabled={granting || !newEmail.trim()}
                style={{ ...tBtnP, fontSize: 12, padding: "8px 20px", opacity: (granting || !newEmail.trim()) ? 0.5 : 1 }}>
                {granting ? "Granting…" : "Grant Access"}
              </button>
            </div>
            {grantMsg && <div style={{ marginTop: 10, fontSize: 12, color: grantMsg.startsWith("✓") ? "#8ec8a0" : "#e07050" }}>{grantMsg}</div>}

            {/* Role descriptions */}
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              {ADMIN_ROLES.map((r) => (
                <div key={r.value} style={{ display: "flex", gap: 10, fontSize: 11, color: theme.textDim }}>
                  <span style={{ fontWeight: 700, color: theme.textMuted, width: 110, flexShrink: 0 }}>{r.label}</span>
                  <span>{r.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Current admins list */}
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: theme.textDim, letterSpacing: 0.5, marginBottom: 10 }}>Current Admin Users</div>
          {!adminsLoaded ? (
            <div style={{ padding: 20, color: theme.textDim }}>Loading…</div>
          ) : admins.length === 0 ? (
            <div style={{ padding: 20, color: theme.textDim }}>No admin users found.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {admins.map((a) => {
                const roleColor = a.admin_role === "super_admin" ? "#f0c040" : a.admin_role === "support_admin" ? "#8ec8a0" : "#7ec8e3";
                return (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.divider, borderRadius: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: ta(roleColor, 0.12), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: roleColor, flexShrink: 0 }}>
                      {a.admin_role === "super_admin" ? "👑" : a.admin_role === "support_admin" ? "📋" : "🔧"}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{a.user_email}</div>
                      <div style={{ fontSize: 10, color: theme.textDim }}>
                        Granted {new Date(a.granted_at).toLocaleDateString()}
                        {a.notes && <span> · {a.notes}</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, padding: "2px 10px", borderRadius: 10, background: roleColor + "20", color: roleColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, flexShrink: 0 }}>
                      {a.admin_role.replace("_", " ")}
                    </span>
                    {a.admin_role !== "super_admin" && (
                      <button onClick={() => handleRevoke(a.id, a.user_email)}
                        style={{ fontSize: 10, color: "#e07050", background: "rgba(224,112,80,0.08)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                        Revoke
                      </button>
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

export default AdminPanel;