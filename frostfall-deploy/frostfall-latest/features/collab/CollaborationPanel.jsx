"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fetchWorldMembers, createWorldInvite, fetchWorldInvites,
  deactivateInvite, acceptInvite, updateMemberRole, removeMember,
} from "@/lib/supabase";

/**
 * CollaborationPanel — World member management, invite system, role control
 * Shown in Settings or as its own view. Requires an active world.
 */

const ROLES = {
  owner: { label: "Owner", color: "#f0c040", icon: "👑", desc: "Full control — manage members, edit, delete" },
  editor: { label: "Editor", color: "#8ec8a0", icon: "✎", desc: "Can create, edit, and delete articles" },
  viewer: { label: "Viewer", color: "#7ec8e3", icon: "👁", desc: "Read-only access to the codex" },
};

export function CollaborationPanel({ theme, ta, tBtnP, tBtnS, S, Ornament, activeWorld, user, isMobile, onWorldsRefresh }) {
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviteMaxUses, setInviteMaxUses] = useState("");
  const [inviteExpires, setInviteExpires] = useState("");
  const [createdInvite, setCreatedInvite] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinResult, setJoinResult] = useState(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [tab, setTab] = useState("members"); // "members" | "invites" | "join"

  const isOwner = members.some((m) => m.userId === user?.id && m.role === "owner");
  const myRole = members.find((m) => m.userId === user?.id)?.role || "viewer";

  const loadData = useCallback(async () => {
    if (!activeWorld?.id) return;
    setLoading(true);
    const [m, i] = await Promise.all([
      fetchWorldMembers(activeWorld.id),
      fetchWorldInvites(activeWorld.id),
    ]);
    setMembers(m);
    setInvites(i);
    setLoading(false);
  }, [activeWorld?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateInvite = async () => {
    const maxUses = inviteMaxUses ? parseInt(inviteMaxUses) : null;
    const expDays = inviteExpires ? parseInt(inviteExpires) : null;
    const invite = await createWorldInvite(activeWorld.id, inviteRole, maxUses, expDays);
    if (invite) {
      setCreatedInvite(invite);
      setInvites((prev) => [invite, ...prev]);
    }
  };

  const handleDeactivate = async (inviteId) => {
    const ok = await deactivateInvite(inviteId);
    if (ok) setInvites((prev) => prev.filter((i) => i.id !== inviteId));
  };

  const handleRoleChange = async (memberId, newRole) => {
    const ok = await updateMemberRole(memberId, newRole);
    if (ok) setMembers((prev) => prev.map((m) => m.id === memberId ? { ...m, role: newRole } : m));
  };

  const handleRemove = async (memberId, name) => {
    if (!confirm("Remove " + name + " from this world?")) return;
    const ok = await removeMember(memberId);
    if (ok) setMembers((prev) => prev.filter((m) => m.id !== memberId));
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    setJoinLoading(true);
    setJoinResult(null);
    const result = await acceptInvite(joinCode.trim());
    setJoinLoading(false);
    if (result.success) {
      setJoinResult({ type: "success", message: "Joined \"" + result.world?.name + "\" as " + result.role + "!" });
      setJoinCode("");
      if (onWorldsRefresh) onWorldsRefresh();
    } else {
      setJoinResult({ type: "error", message: result.error });
    }
  };

  const copyInviteLink = (code) => {
    const url = typeof window !== "undefined" ? window.location.origin + "?invite=" + code : code;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCreatedInvite((prev) => prev?.invite_code === code ? { ...prev, _copied: true } : prev);
    setTimeout(() => setCreatedInvite((prev) => prev?._copied ? { ...prev, _copied: false } : prev), 2000);
  };

  if (!activeWorld) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: theme.textDim }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🌍</div>
        <p>Select or create a world first to manage collaboration.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1 }}>👥 Collaboration</h2>
        <Ornament width={100} />
        <span style={{ fontSize: 12, color: theme.textMuted }}>
          {activeWorld.name} · {members.length} member{members.length !== 1 ? "s" : ""}
          {myRole && <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 10, background: ROLES[myRole]?.color + "20", color: ROLES[myRole]?.color, fontWeight: 600 }}>{ROLES[myRole]?.icon} {ROLES[myRole]?.label}</span>}
        </span>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
        {[
          { id: "members", label: "Members", icon: "👥", count: members.length },
          { id: "invites", label: "Invite Links", icon: "🔗", count: invites.length },
          { id: "join", label: "Join a World", icon: "🎟" },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ fontSize: 12, padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontFamily: "'Cinzel', serif", fontWeight: tab === t.id ? 600 : 400, letterSpacing: 0.5, border: "1px solid " + (tab === t.id ? ta(theme.accent, 0.4) : theme.border), background: tab === t.id ? ta(theme.accent, 0.1) : "transparent", color: tab === t.id ? theme.accent : theme.textMuted, transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6 }}>
            <span>{t.icon}</span> {t.label}
            {t.count != null && <span style={{ fontSize: 10, opacity: 0.7 }}>({t.count})</span>}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: theme.textDim }}>Loading...</div>}

      {/* MEMBERS TAB */}
      {!loading && tab === "members" && (
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {members.map((m) => {
              const role = ROLES[m.role] || ROLES.viewer;
              const isMe = m.userId === user?.id;
              const isOnlyOwner = m.role === "owner" && members.filter((x) => x.role === "owner").length === 1;
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: isMe ? ta(theme.accent, 0.04) : ta(theme.surface, 0.5), borderTop: "1px solid " + theme.divider, borderRight: "1px solid " + theme.divider, borderBottom: "1px solid " + theme.divider, borderLeft: "3px solid " + role.color, borderRadius: 8 }}>
                  {/* Avatar */}
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: ta(role.color, 0.15), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: role.color, flexShrink: 0, border: "1px solid " + role.color + "40" }}>
                    {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} /> : role.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: theme.text, fontSize: 13 }}>{m.displayName}{isMe && <span style={{ fontSize: 10, color: theme.textDim, marginLeft: 6 }}>(you)</span>}</div>
                    <div style={{ fontSize: 10, color: theme.textDim }}>Joined {new Date(m.joinedAt).toLocaleDateString()}</div>
                  </div>
                  {/* Role badge */}
                  {isOwner && !isMe ? (
                    <select value={m.role} onChange={(e) => handleRoleChange(m.id, e.target.value)}
                      style={{ background: theme.inputBg, border: "1px solid " + role.color + "40", borderRadius: 6, fontSize: 11, color: role.color, padding: "4px 8px", cursor: "pointer", outline: "none", fontFamily: "inherit", fontWeight: 600 }}>
                      <option value="editor">✎ Editor</option>
                      <option value="viewer">👁 Viewer</option>
                    </select>
                  ) : (
                    <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 10, background: role.color + "20", color: role.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{role.icon} {role.label}</span>
                  )}
                  {/* Remove button */}
                  {isOwner && !isMe && !isOnlyOwner && (
                    <button onClick={() => handleRemove(m.id, m.displayName)}
                      style={{ fontSize: 10, color: "#e07050", background: "rgba(224,112,80,0.08)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                  )}
                </div>
              );
            })}
          </div>
          {members.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: theme.textDim }}>
              <p>No members found. Create an invite to add collaborators.</p>
            </div>
          )}
        </div>
      )}

      {/* INVITES TAB */}
      {!loading && tab === "invites" && (
        <div>
          {isOwner && (
            <div style={{ padding: "16px 20px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.border, borderRadius: 10, marginBottom: 20 }}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: theme.text, fontWeight: 600, marginBottom: 12, letterSpacing: 0.5 }}>Create New Invite</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>Role</label>
                  <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
                    style={{ ...S.input, width: 120, padding: "6px 10px", fontSize: 12 }}>
                    <option value="viewer">👁 Viewer</option>
                    <option value="editor">✎ Editor</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>Max Uses</label>
                  <input type="number" min="1" placeholder="∞"
                    value={inviteMaxUses} onChange={(e) => setInviteMaxUses(e.target.value)}
                    style={{ ...S.input, width: 80, padding: "6px 10px", fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>Expires (days)</label>
                  <input type="number" min="1" placeholder="Never"
                    value={inviteExpires} onChange={(e) => setInviteExpires(e.target.value)}
                    style={{ ...S.input, width: 80, padding: "6px 10px", fontSize: 12 }} />
                </div>
                <button onClick={handleCreateInvite} style={{ ...tBtnP, fontSize: 11, padding: "7px 18px" }}>Generate Link</button>
              </div>

              {/* Created invite display */}
              {createdInvite && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: ta("#8ec8a0", 0.08), border: "1px solid rgba(142,200,160,0.3)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#8ec8a0", fontWeight: 600, marginBottom: 6 }}>✓ Invite Created!</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{ flex: 1, fontSize: 15, fontWeight: 700, color: theme.text, letterSpacing: 2, background: ta(theme.deepBg, 0.6), padding: "6px 12px", borderRadius: 6, fontFamily: "'Fira Code', monospace" }}>
                      {createdInvite.invite_code}
                    </code>
                    <button onClick={() => copyInviteLink(createdInvite.invite_code)}
                      style={{ ...tBtnS, fontSize: 10, padding: "6px 12px" }}>
                      {createdInvite._copied ? "✓ Copied!" : "📋 Copy Link"}
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: theme.textDim, marginTop: 6 }}>
                    Share this code with collaborators. They can use it in the "Join a World" tab.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Active invites list */}
          {invites.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {invites.map((inv) => {
                const role = ROLES[inv.role] || ROLES.viewer;
                const isExpired = inv.expires_at && new Date(inv.expires_at) < new Date();
                const isMaxed = inv.max_uses && inv.use_count >= inv.max_uses;
                return (
                  <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.divider, borderRadius: 8, opacity: isExpired || isMaxed ? 0.5 : 1 }}>
                    <code style={{ fontSize: 13, fontWeight: 700, color: theme.text, letterSpacing: 2, fontFamily: "'Fira Code', monospace", minWidth: 100 }}>{inv.invite_code}</code>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: role.color + "20", color: role.color, fontWeight: 600 }}>{role.icon} {role.label}</span>
                    <span style={{ fontSize: 10, color: theme.textDim }}>Used {inv.use_count}{inv.max_uses ? "/" + inv.max_uses : ""} times</span>
                    {inv.expires_at && <span style={{ fontSize: 10, color: isExpired ? "#e07050" : theme.textDim }}>{isExpired ? "Expired" : "Expires " + new Date(inv.expires_at).toLocaleDateString()}</span>}
                    <div style={{ flex: 1 }} />
                    {isOwner && (
                      <button onClick={() => handleDeactivate(inv.id)}
                        style={{ fontSize: 10, color: "#e07050", background: "rgba(224,112,80,0.08)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontFamily: "inherit" }}>
                        Revoke
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 30, color: theme.textDim }}>
              <p>No active invite links.{isOwner ? " Create one above to invite collaborators." : ""}</p>
            </div>
          )}
        </div>
      )}

      {/* JOIN TAB */}
      {!loading && tab === "join" && (
        <div>
          <div style={{ padding: "20px 24px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.border, borderRadius: 10 }}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: theme.text, fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>Join a Shared World</div>
            <p style={{ fontSize: 12, color: theme.textDim, marginBottom: 16, lineHeight: 1.6 }}>
              Enter an invite code from another world's owner to join as a collaborator.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Enter invite code (e.g. AB3XK7QR)"
                maxLength={12}
                style={{ ...S.input, flex: 1, fontSize: 15, letterSpacing: 3, fontWeight: 700, fontFamily: "'Fira Code', monospace", textAlign: "center" }}
                onKeyDown={(e) => { if (e.key === "Enter") handleJoin(); }} />
              <button onClick={handleJoin} disabled={joinLoading || !joinCode.trim()}
                style={{ ...tBtnP, fontSize: 12, padding: "8px 24px", opacity: (joinLoading || !joinCode.trim()) ? 0.4 : 1 }}>
                {joinLoading ? "Joining..." : "Join World"}
              </button>
            </div>
            {joinResult && (
              <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: joinResult.type === "success" ? "rgba(142,200,160,0.1)" : "rgba(224,112,80,0.1)", border: "1px solid " + (joinResult.type === "success" ? "rgba(142,200,160,0.3)" : "rgba(224,112,80,0.3)"), color: joinResult.type === "success" ? "#8ec8a0" : "#e07050", fontSize: 13 }}>
                {joinResult.type === "success" ? "✓ " : "✕ "}{joinResult.message}
              </div>
            )}
          </div>

          {/* Role explanation */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: theme.textDim, letterSpacing: 0.5, marginBottom: 10 }}>Role Permissions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(ROLES).map(([key, role]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: ta(theme.surface, 0.4), border: "1px solid " + theme.divider, borderRadius: 6 }}>
                  <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{role.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: role.color }}>{role.label}</div>
                    <div style={{ fontSize: 10, color: theme.textDim }}>{role.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CollaborationPanel;