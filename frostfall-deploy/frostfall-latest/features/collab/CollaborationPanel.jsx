"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fetchWorldMembers, createWorldInvite, fetchWorldInvites,
  deactivateInvite, acceptInvite, updateMemberRole, removeMember,
} from "@/lib/supabase";

const ROLES = {
  owner: { label: "Owner", color: "#f0c040", icon: "👑", desc: "Full control — manage members, edit, delete" },
  editor: { label: "Editor", color: "#8ec8a0", icon: "✎", desc: "Can create, edit, and delete articles" },
  viewer: { label: "Viewer", color: "#7ec8e3", icon: "👁", desc: "Read-only access to the codex" },
};

const SETUP_HINT = "Run schema_collaboration.sql in Supabase Dashboard → SQL Editor to create the required tables.";

export function CollaborationPanel({ theme, ta, tBtnP, tBtnS, S, Ornament, activeWorld, user, isMobile, onWorldsRefresh }) {
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviteMaxUses, setInviteMaxUses] = useState("");
  const [inviteExpires, setInviteExpires] = useState("");
  const [createdInvite, setCreatedInvite] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinResult, setJoinResult] = useState(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [tab, setTab] = useState("members");

  const isWorldCreator = activeWorld?.user_id === user?.id;
  const memberRecord = members.find((m) => m.userId === user?.id);
  const isOwner = memberRecord ? memberRecord.role === "owner" : isWorldCreator;
  const myRole = memberRecord?.role || (isWorldCreator ? "owner" : "viewer");

  const loadData = useCallback(async () => {
    if (!activeWorld?.id) return;
    setLoading(true);
    setSetupNeeded(false);
    const membersResult = await fetchWorldMembers(activeWorld.id);
    const invitesResult = await fetchWorldInvites(activeWorld.id);

    if (membersResult.error === "table_missing" || invitesResult.error === "table_missing") {
      setSetupNeeded(true);
      if (isWorldCreator) {
        setMembers([{ id: "virtual_owner", userId: user.id, role: "owner", joinedAt: activeWorld.created_at || new Date().toISOString(), displayName: user.user_metadata?.display_name || user.email?.split("@")[0] || "You", avatarUrl: null }]);
      } else { setMembers([]); }
      setInvites([]);
    } else {
      let ml = membersResult.members || [];
      if (ml.length === 0 && isWorldCreator) {
        ml = [{ id: "fallback_owner", userId: user.id, role: "owner", joinedAt: activeWorld.created_at || new Date().toISOString(), displayName: user.user_metadata?.display_name || user.email?.split("@")[0] || "You", avatarUrl: null }];
      }
      setMembers(ml);
      setInvites(invitesResult.invites || []);
    }
    setLoading(false);
  }, [activeWorld?.id, isWorldCreator, user]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateInvite = async () => {
    if (setupNeeded) return;
    const invite = await createWorldInvite(activeWorld.id, inviteRole, inviteMaxUses ? parseInt(inviteMaxUses) : null, inviteExpires ? parseInt(inviteExpires) : null);
    if (invite) { setCreatedInvite(invite); setInvites((prev) => [invite, ...prev]); }
  };
  const handleDeactivate = async (inviteId) => { if (await deactivateInvite(inviteId)) setInvites((prev) => prev.filter((i) => i.id !== inviteId)); };
  const handleRoleChange = async (memberId, newRole) => { if (memberId.startsWith("virtual") || memberId.startsWith("fallback")) return; if (await updateMemberRole(memberId, newRole)) setMembers((prev) => prev.map((m) => m.id === memberId ? { ...m, role: newRole } : m)); };
  const handleRemove = async (memberId, name) => { if (memberId.startsWith("virtual") || memberId.startsWith("fallback")) return; if (!confirm("Remove " + name + "?")) return; if (await removeMember(memberId)) setMembers((prev) => prev.filter((m) => m.id !== memberId)); };
  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    setJoinLoading(true); setJoinResult(null);
    const result = await acceptInvite(joinCode.trim());
    setJoinLoading(false);
    if (result.success) { setJoinResult({ type: "success", message: "Joined \"" + result.world?.name + "\" as " + result.role + "!" }); setJoinCode(""); if (onWorldsRefresh) onWorldsRefresh(); }
    else setJoinResult({ type: "error", message: result.error });
  };
  const copyCode = (code) => { navigator.clipboard?.writeText(code).catch(() => {}); setCreatedInvite((p) => p?.invite_code === code ? { ...p, _copied: true } : p); setTimeout(() => setCreatedInvite((p) => p?._copied ? { ...p, _copied: false } : p), 2000); };

  if (!activeWorld) return (<div style={{ textAlign: "center", padding: 40, color: theme.textDim }}><div style={{ fontSize: 32, marginBottom: 8 }}>🌍</div><p>Select or create a world first.</p></div>);

  const ri = ROLES[myRole] || ROLES.owner;
  return (
    <div style={{ marginTop: 24, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1 }}>👥 Collaboration</h2>
        <Ornament width={100} />
        <span style={{ fontSize: 12, color: theme.textMuted }}>{activeWorld.name} · {members.length} member{members.length !== 1 ? "s" : ""}</span>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: ri.color + "20", color: ri.color, fontWeight: 600 }}>{ri.icon} {ri.label}</span>
      </div>

      {setupNeeded && (
        <div style={{ padding: "14px 18px", background: "rgba(240,192,64,0.08)", borderTop: "1px solid rgba(240,192,64,0.2)", borderRight: "1px solid rgba(240,192,64,0.2)", borderBottom: "1px solid rgba(240,192,64,0.2)", borderLeft: "3px solid #f0c040", borderRadius: 8, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚠</span>
            <div>
              <div style={{ fontWeight: 700, color: "#f0c040", marginBottom: 4, fontSize: 13 }}>Database Setup Required</div>
              <div style={{ color: theme.textMuted, fontSize: 12, lineHeight: 1.6 }}>
                The collaboration tables haven't been created yet. You're shown as Owner because you created this world, but invites and member management require the tables.
              </div>
              <div style={{ marginTop: 8, padding: "8px 12px", background: ta(theme.deepBg, 0.6), borderRadius: 6, fontSize: 11, color: theme.textDim, lineHeight: 1.5 }}>{SETUP_HINT}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
        {[{ id: "members", label: "Members", icon: "👥", count: members.length }, { id: "invites", label: "Invite Links", icon: "🔗", count: invites.length, disabled: setupNeeded }, { id: "join", label: "Join a World", icon: "🎟" }].map((t) => (
          <button key={t.id} onClick={() => !t.disabled && setTab(t.id)} style={{ fontSize: 12, padding: "8px 18px", borderRadius: 8, cursor: t.disabled ? "not-allowed" : "pointer", fontFamily: "'Cinzel', serif", fontWeight: tab === t.id ? 600 : 400, letterSpacing: 0.5, border: "1px solid " + (tab === t.id ? ta(theme.accent, 0.4) : theme.border), background: tab === t.id ? ta(theme.accent, 0.1) : "transparent", color: tab === t.id ? theme.accent : theme.textMuted, transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6, opacity: t.disabled ? 0.4 : 1 }}>
            <span>{t.icon}</span> {t.label} {t.count != null && <span style={{ fontSize: 10, opacity: 0.7 }}>({t.count})</span>}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: theme.textDim }}>Loading...</div>}

      {!loading && tab === "members" && (<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {members.map((m) => { const role = ROLES[m.role] || ROLES.viewer; const isMe = m.userId === user?.id; const isVirtual = m.id?.startsWith("virtual") || m.id?.startsWith("fallback"); return (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: isMe ? ta(theme.accent, 0.04) : ta(theme.surface, 0.5), borderTop: "1px solid " + theme.divider, borderRight: "1px solid " + theme.divider, borderBottom: "1px solid " + theme.divider, borderLeft: "3px solid " + role.color, borderRadius: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: ta(role.color, 0.15), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: role.color, flexShrink: 0, border: "1px solid " + role.color + "40" }}>{m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} /> : role.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: theme.text, fontSize: 13 }}>{m.displayName}{isMe && <span style={{ fontSize: 10, color: theme.textDim, marginLeft: 6 }}>(you)</span>}</div>
              <div style={{ fontSize: 10, color: theme.textDim }}>{isVirtual ? "World creator" : "Joined " + new Date(m.joinedAt).toLocaleDateString()}</div>
            </div>
            {isOwner && !isMe && !isVirtual ? (
              <select value={m.role} onChange={(e) => handleRoleChange(m.id, e.target.value)} style={{ background: theme.inputBg, border: "1px solid " + role.color + "40", borderRadius: 6, fontSize: 11, color: role.color, padding: "4px 8px", cursor: "pointer", outline: "none", fontFamily: "inherit", fontWeight: 600 }}>
                <option value="editor">✎ Editor</option><option value="viewer">👁 Viewer</option>
              </select>
            ) : (<span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 10, background: role.color + "20", color: role.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{role.icon} {role.label}</span>)}
            {isOwner && !isMe && !isVirtual && <button onClick={() => handleRemove(m.id, m.displayName)} style={{ fontSize: 10, color: "#e07050", background: "rgba(224,112,80,0.08)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>✕</button>}
          </div>); })}
        {members.length === 0 && <div style={{ textAlign: "center", padding: 40, color: theme.textDim }}><p>No members found.</p></div>}
      </div>)}

      {!loading && tab === "invites" && (<div>
        {setupNeeded ? (<div style={{ textAlign: "center", padding: 40, color: theme.textDim }}><div style={{ fontSize: 32, marginBottom: 8 }}>🔗</div><p>Invite links require database setup. See the banner above.</p></div>) : (<>
          {isOwner && (<div style={{ padding: "16px 20px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.border, borderRadius: 10, marginBottom: 20 }}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: theme.text, fontWeight: 600, marginBottom: 12 }}>Create New Invite</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div><label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>Role</label>
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={{ ...S.input, width: 120, padding: "6px 10px", fontSize: 12 }}><option value="viewer">👁 Viewer</option><option value="editor">✎ Editor</option></select></div>
              <div><label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>Max Uses</label>
                <input type="number" min="1" placeholder="∞" value={inviteMaxUses} onChange={(e) => setInviteMaxUses(e.target.value)} style={{ ...S.input, width: 80, padding: "6px 10px", fontSize: 12 }} /></div>
              <div><label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>Expires (days)</label>
                <input type="number" min="1" placeholder="Never" value={inviteExpires} onChange={(e) => setInviteExpires(e.target.value)} style={{ ...S.input, width: 80, padding: "6px 10px", fontSize: 12 }} /></div>
              <button onClick={handleCreateInvite} style={{ ...tBtnP, fontSize: 11, padding: "7px 18px" }}>Generate Invite Code</button>
            </div>
            {createdInvite && (<div style={{ marginTop: 12, padding: "10px 14px", background: ta("#8ec8a0", 0.08), border: "1px solid rgba(142,200,160,0.3)", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "#8ec8a0", fontWeight: 600, marginBottom: 6 }}>✓ Invite Created!</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ flex: 1, fontSize: 15, fontWeight: 700, color: theme.text, letterSpacing: 2, background: ta(theme.deepBg, 0.6), padding: "6px 12px", borderRadius: 6, fontFamily: "'Fira Code', monospace" }}>{createdInvite.invite_code}</code>
                <button onClick={() => copyCode(createdInvite.invite_code)} style={{ ...tBtnS, fontSize: 10, padding: "6px 12px" }}>{createdInvite._copied ? "✓ Copied!" : "📋 Copy"}</button>
              </div>
              <div style={{ fontSize: 10, color: theme.textDim, marginTop: 6 }}>Share this code. Recipients enter it in the "Join a World" tab.</div>
            </div>)}
          </div>)}
          {!isOwner && <div style={{ padding: "14px 18px", background: ta(theme.textDim, 0.06), borderRadius: 8, marginBottom: 16, fontSize: 12, color: theme.textDim }}>Only the world owner can create and manage invite links.</div>}
          {invites.length > 0 ? (<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{invites.map((inv) => { const role = ROLES[inv.role] || ROLES.viewer; const isExpired = inv.expires_at && new Date(inv.expires_at) < new Date(); const isMaxed = inv.max_uses && inv.use_count >= inv.max_uses; return (
            <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.divider, borderRadius: 8, opacity: isExpired || isMaxed ? 0.5 : 1, flexWrap: "wrap" }}>
              <code style={{ fontSize: 13, fontWeight: 700, color: theme.text, letterSpacing: 2, fontFamily: "'Fira Code', monospace" }}>{inv.invite_code}</code>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: role.color + "20", color: role.color, fontWeight: 600 }}>{role.icon} {role.label}</span>
              <span style={{ fontSize: 10, color: theme.textDim }}>Used {inv.use_count}{inv.max_uses ? "/" + inv.max_uses : ""}</span>
              {inv.expires_at && <span style={{ fontSize: 10, color: isExpired ? "#e07050" : theme.textDim }}>{isExpired ? "Expired" : "Exp " + new Date(inv.expires_at).toLocaleDateString()}</span>}
              <div style={{ flex: 1 }} />
              {isOwner && <button onClick={() => handleDeactivate(inv.id)} style={{ fontSize: 10, color: "#e07050", background: "rgba(224,112,80,0.08)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontFamily: "inherit" }}>Revoke</button>}
            </div>); })}</div>) : (<div style={{ textAlign: "center", padding: 30, color: theme.textDim }}><p>No active invites.{isOwner ? " Create one above." : ""}</p></div>)}
        </>)}
      </div>)}

      {!loading && tab === "join" && (<div>
        <div style={{ padding: "20px 24px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.border, borderRadius: 10 }}>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: theme.text, fontWeight: 600, marginBottom: 8 }}>Join a Shared World</div>
          <p style={{ fontSize: 12, color: theme.textDim, marginBottom: 16, lineHeight: 1.6 }}>Enter an invite code from another world's owner to join as a collaborator.</p>
          <div style={{ display: "flex", gap: 10 }}>
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="INVITE CODE" maxLength={12}
              style={{ ...S.input, flex: 1, fontSize: 15, letterSpacing: 3, fontWeight: 700, fontFamily: "'Fira Code', monospace", textAlign: "center" }} onKeyDown={(e) => { if (e.key === "Enter") handleJoin(); }} />
            <button onClick={handleJoin} disabled={joinLoading || !joinCode.trim()} style={{ ...tBtnP, fontSize: 12, padding: "8px 24px", opacity: (joinLoading || !joinCode.trim()) ? 0.4 : 1 }}>{joinLoading ? "Joining..." : "Join World"}</button>
          </div>
          {joinResult && (<div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: joinResult.type === "success" ? "rgba(142,200,160,0.1)" : "rgba(224,112,80,0.1)", border: "1px solid " + (joinResult.type === "success" ? "rgba(142,200,160,0.3)" : "rgba(224,112,80,0.3)"), color: joinResult.type === "success" ? "#8ec8a0" : "#e07050", fontSize: 13 }}>{joinResult.type === "success" ? "✓ " : "✕ "}{joinResult.message}</div>)}
        </div>
        <div style={{ marginTop: 20 }}>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: theme.textDim, letterSpacing: 0.5, marginBottom: 10 }}>Role Permissions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {Object.entries(ROLES).map(([key, role]) => (<div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: ta(theme.surface, 0.4), border: "1px solid " + theme.divider, borderRadius: 6 }}><span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{role.icon}</span><div><div style={{ fontSize: 12, fontWeight: 600, color: role.color }}>{role.label}</div><div style={{ fontSize: 10, color: theme.textDim }}>{role.desc}</div></div></div>))}
          </div>
        </div>
      </div>)}
    </div>
  );
}
export default CollaborationPanel;