import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase env vars missing — running in local-only mode");
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// === HELPER: Upload portrait image ===
export async function uploadPortrait(userId, file) {
  if (!supabase) return null;
  const ext = file.name.split(".").pop();
  const path = `${userId}/${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage
    .from("portraits")
    .upload(path, file, { upsert: true });
  if (error) { console.error("Upload error:", error); return null; }
  const { data: urlData } = supabase.storage.from("portraits").getPublicUrl(data.path);
  return urlData.publicUrl;
}

// === HELPER: Fetch all articles for a world ===
export async function fetchArticles(worldId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("articles")
    .select("*")
    .eq("world_id", worldId)
    .order("created_at", { ascending: false });
  if (error) { console.error("Fetch error:", error); return []; }
  return data.map(dbToArticle);
}

// === HELPER: Upsert article ===
export async function upsertArticle(worldId, article) {
  if (!supabase) return null;
  const row = articleToDb(worldId, article);
  const { data, error } = await supabase
    .from("articles")
    .upsert(row, { onConflict: "world_id,slug" })
    .select()
    .single();
  if (error) { console.error("Upsert error:", error); return null; }
  return dbToArticle(data);
}

// === HELPER: Delete article ===
export async function deleteArticle(articleUuid) {
  if (!supabase) return false;
  const { error } = await supabase.from("articles").delete().eq("id", articleUuid);
  return !error;
}

// === HELPER: Archive / unarchive ===
export async function archiveArticle(articleUuid, archive = true) {
  if (!supabase) return false;
  const { error } = await supabase.from("articles").update({
    is_archived: archive,
    archived_at: archive ? new Date().toISOString() : null,
  }).eq("id", articleUuid);
  return !error;
}

// === HELPER: Create world ===
export async function createWorld(userId, name, description) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("worlds")
    .insert({ user_id: userId, name, description })
    .select()
    .single();
  if (error) { console.error("Create world error:", error); return null; }
  return data;
}

// === HELPER: Fetch user's worlds (including shared) ===
export async function fetchWorlds(userId) {
  if (!supabase) return [];
  // Try the user_worlds view first (includes shared worlds with role)
  const { data: viewData, error: viewError } = await supabase
    .from("user_worlds")
    .select("*")
    .order("updated_at", { ascending: false });
  if (!viewError && viewData && viewData.length > 0) return viewData;
  // Fallback: direct query on worlds table (owner-only, always works)
  const { data, error } = await supabase
    .from("worlds")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) { console.error("Fetch worlds error:", error); return []; }
  return data.map((w) => ({ ...w, member_role: "owner" }));
}

// ================================================================
// COLLABORATION
// ================================================================

// Generate a random invite code
function generateInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Create an invite for a world
export async function createWorldInvite(worldId, role = "viewer", maxUses = null, expiresInDays = null) {
  if (!supabase) return null;
  const user = (await supabase.auth.getUser())?.data?.user;
  if (!user) return null;
  const code = generateInviteCode();
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000).toISOString() : null;
  const { data, error } = await supabase
    .from("world_invites")
    .insert({ world_id: worldId, invite_code: code, role, created_by: user.id, max_uses: maxUses, expires_at: expiresAt })
    .select()
    .single();
  if (error) { console.error("Create invite error:", error); return null; }
  return data;
}

// Fetch active invites for a world
export async function fetchWorldInvites(worldId) {
  if (!supabase) return { invites: [], error: "no_supabase" };
  const { data, error } = await supabase
    .from("world_invites")
    .select("*")
    .eq("world_id", worldId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Fetch invites error:", error);
    const msg = error.message || "";
    const isTableMissing = error.code === "42P01" || /relation.*world_invites.*does not exist/i.test(msg);
    return { invites: [], error: isTableMissing ? "table_missing" : msg };
  }
  return { invites: data || [], error: null };
}

// Deactivate an invite
export async function deactivateInvite(inviteId) {
  if (!supabase) return false;
  const { error } = await supabase.from("world_invites").update({ is_active: false }).eq("id", inviteId);
  return !error;
}

// Accept an invite code — join the world
export async function acceptInvite(inviteCode) {
  if (!supabase) return { error: "No database connection" };
  const user = (await supabase.auth.getUser())?.data?.user;
  if (!user) return { error: "Not logged in" };

  // Look up the invite
  const { data: invite, error: lookupErr } = await supabase
    .from("world_invites")
    .select("*")
    .eq("invite_code", inviteCode.trim().toUpperCase())
    .eq("is_active", true)
    .single();

  if (lookupErr || !invite) return { error: "Invalid or expired invite code" };
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return { error: "This invite has expired" };
  if (invite.max_uses && invite.use_count >= invite.max_uses) return { error: "This invite has reached its usage limit" };

  // Check if already a member
  const { data: existing } = await supabase
    .from("world_members")
    .select("id")
    .eq("world_id", invite.world_id)
    .eq("user_id", user.id)
    .single();

  if (existing) return { error: "You're already a member of this world" };

  // Add as member
  const { error: joinErr } = await supabase
    .from("world_members")
    .insert({ world_id: invite.world_id, user_id: user.id, role: invite.role, invited_by: invite.created_by });

  if (joinErr) return { error: "Failed to join: " + joinErr.message };

  // Increment use count
  await supabase.from("world_invites").update({ use_count: invite.use_count + 1 }).eq("id", invite.id);

  // Fetch the world info
  const { data: world } = await supabase.from("worlds").select("*").eq("id", invite.world_id).single();
  return { success: true, world, role: invite.role };
}

// Fetch members of a world
export async function fetchWorldMembers(worldId) {
  if (!supabase) return { members: [], error: "no_supabase" };

  const { data, error } = await supabase
    .from("world_members")
    .select("*")
    .eq("world_id", worldId)
    .order("joined_at", { ascending: true });

  if (error) {
    console.error("Fetch members error:", error);
    const msg = error.message || "";
    // Only flag as table_missing for genuine 42P01 or "relation ... does not exist"
    const isTableMissing = error.code === "42P01" || /relation.*world_members.*does not exist/i.test(msg);
    return { members: [], error: isTableMissing ? "table_missing" : msg };
  }

  // Fetch display names separately (profiles may or may not be joinable)
  const members = (data || []).map((m) => ({
    id: m.id,
    userId: m.user_id,
    role: m.role,
    joinedAt: m.joined_at,
    displayName: null,
    avatarUrl: null,
  }));

  // Try to enrich with profile data (non-blocking)
  try {
    const userIds = members.map((m) => m.userId).filter(Boolean);
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds);
      if (profiles) {
        const profileMap = {};
        profiles.forEach((p) => { profileMap[p.id] = p; });
        members.forEach((m) => {
          const p = profileMap[m.userId];
          if (p) {
            m.displayName = p.display_name || null;
            m.avatarUrl = p.avatar_url || null;
          }
        });
      }
    }
  } catch (_) { /* profiles table may not exist — that's OK */ }

  // Fill in missing display names
  members.forEach((m) => { if (!m.displayName) m.displayName = "User"; });

  return { members, error: null };
}

// Update a member's role
export async function updateMemberRole(memberId, newRole) {
  if (!supabase) return false;
  const { error } = await supabase.from("world_members").update({ role: newRole, updated_at: new Date().toISOString() }).eq("id", memberId);
  return !error;
}

// Remove a member from a world
export async function removeMember(memberId) {
  if (!supabase) return false;
  const { error } = await supabase.from("world_members").delete().eq("id", memberId);
  return !error;
}

// ================================================================
// SUPPORT TICKETS
// ================================================================

export async function submitSupportTicket(category, subject, description) {
  if (!supabase) return { error: "No database connection. Supabase is not configured." };
  const user = (await supabase.auth.getUser())?.data?.user;
  if (!user) return { error: "Not logged in" };

  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      user_id: user.id,
      user_email: user.email,
      display_name: user.user_metadata?.display_name || user.email?.split("@")[0] || "User",
      category,
      subject,
      description,
    })
    .select()
    .single();
  if (error) {
    const msg = error.message || "";
    const isTableMissing = error.code === "42P01" || /relation.*support_tickets.*does not exist/i.test(msg);
    if (isTableMissing) return { error: "table_missing" };
    return { error: msg };
  }
  return { success: true, ticket: data };
}

export async function fetchMyTickets() {
  if (!supabase) return { tickets: [], error: "no_supabase" };
  const { data, error } = await supabase
    .from("support_tickets")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("Fetch tickets error:", error);
    const msg = error.message || "";
    const isTableMissing = error.code === "42P01" || /relation.*support_tickets.*does not exist/i.test(msg);
    return { tickets: [], error: isTableMissing ? "table_missing" : msg };
  }
  return { tickets: data || [], error: null };
}

// === TRANSFORM: DB row → app article format ===
function dbToArticle(row) {
  return {
    _uuid: row.id,               // Supabase UUID (for DB operations)
    id: row.slug,                 // App-level slug ID
    title: row.title,
    category: row.category,
    summary: row.summary || "",
    fields: row.fields || {},
    body: row.body || "",
    tags: row.tags || [],
    linkedIds: row.linked_ids || [],
    temporal: row.temporal || null,
    portrait: row.portrait_url || null,
    isArchived: row.is_archived || false,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// === TRANSFORM: App article → DB row ===
function articleToDb(worldId, article) {
  return {
    world_id: worldId,
    slug: article.id,
    title: article.title,
    category: article.category,
    summary: article.summary || null,
    fields: article.fields || {},
    body: article.body || null,
    tags: article.tags || [],
    linked_ids: article.linkedIds || [],
    temporal: article.temporal || null,
    portrait_url: article.portrait || null,
    is_archived: article.isArchived || false,
    archived_at: article.archivedAt || null,
  };
}

// ================================================================
// ACTIVITY FEED
// ================================================================

/**
 * Log an activity event to the DB (silently fails if table missing).
 * Falls back gracefully — caller never needs to await for correctness.
 */
export async function logActivity(worldId, eventType, {
  articleId = null, articleTitle = null, category = null, meta = {}
} = {}) {
  if (!supabase || !worldId) return;
  try {
    const user = (await supabase.auth.getUser())?.data?.user;
    if (!user) return;
    const actorName =
      user.user_metadata?.display_name ||
      user.email?.split("@")[0] ||
      "Someone";
    await supabase.from("world_activity").insert({
      world_id: worldId,
      user_id: user.id,
      actor_name: actorName,
      event_type: eventType,
      article_id: articleId,
      article_title: articleTitle,
      category,
      meta,
    });
  } catch (_) { /* always silent — activity is non-critical */ }
}

/**
 * Fetch the 60 most recent activity events for a world.
 * Returns { events: [], error: null | "table_missing" | string }
 */
export async function fetchWorldActivity(worldId, limit = 60) {
  if (!supabase || !worldId) return { events: [], error: "no_supabase" };
  const { data, error } = await supabase
    .from("world_activity")
    .select("*")
    .eq("world_id", worldId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    const msg = error.message || "";
    const isTableMissing =
      error.code === "42P01" ||
      /relation.*world_activity.*does not exist/i.test(msg);
    return { events: [], error: isTableMissing ? "table_missing" : msg };
  }
  return { events: data || [], error: null };
}
// ================================================================
// CHARACTER RELATIONS (replaces localStorage)
// ================================================================

export async function fetchCharacterRelations(worldId) {
  if (!supabase || !worldId) return { relations: {}, error: "no_supabase" };
  const { data, error } = await supabase
    .from("character_relations")
    .select("*")
    .eq("world_id", worldId);
  if (error) {
    const msg = error.message || "";
    const missing = error.code === "42P01" || /character_relations.*does not exist/i.test(msg);
    return { relations: {}, error: missing ? "table_missing" : msg };
  }
  // Rebuild into the same { [fromId]: [{targetId, type, confirmed, source, id}] } shape
  const relations = {};
  (data || []).forEach((row) => {
    if (!relations[row.from_id]) relations[row.from_id] = [];
    relations[row.from_id].push({
      id: row.id, targetId: row.to_id,
      type: row.relation_type, confirmed: row.confirmed, source: row.source,
    });
  });
  return { relations, error: null };
}

export async function saveCharacterRelation(worldId, fromId, toId, relationType, confirmed = true, source = "manual") {
  if (!supabase || !worldId) return { error: "no_supabase" };
  const { error } = await supabase.from("character_relations").upsert({
    world_id: worldId, from_id: fromId, to_id: toId,
    relation_type: relationType, confirmed, source,
  }, { onConflict: "world_id,from_id,to_id,relation_type", ignoreDuplicates: false });
  if (error) { console.error("Save relation error:", error); return { error: error.message }; }
  return { success: true };
}

export async function deleteCharacterRelation(worldId, fromId, toId, relationType) {
  if (!supabase || !worldId) return false;
  const { error } = await supabase.from("character_relations")
    .delete()
    .eq("world_id", worldId).eq("from_id", fromId)
    .eq("to_id", toId).eq("relation_type", relationType);
  return !error;
}

export async function confirmCharacterRelation(worldId, fromId, toId, relationType) {
  if (!supabase || !worldId) return false;
  const { error } = await supabase.from("character_relations")
    .update({ confirmed: true })
    .eq("world_id", worldId).eq("from_id", fromId)
    .eq("to_id", toId).eq("relation_type", relationType);
  return !error;
}

// ================================================================
// APP ADMIN
// ================================================================

export async function fetchAdminRole() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("app_admins")
      .select("admin_role, user_email")
      .limit(1)
      .maybeSingle(); // maybeSingle returns null (not error) when no row found
    if (error) {
      // Table missing is expected before schema is run — stay silent
      const isMissing = error.code === "42P01" || /app_admins.*does not exist/i.test(error.message || "");
      if (!isMissing) console.warn("fetchAdminRole error:", error.message);
      return null;
    }
    return data?.admin_role || null;
  } catch (e) {
    console.warn("fetchAdminRole exception:", e);
    return null;
  }
}

export async function fetchAllTickets() {
  if (!supabase) return { tickets: [], error: "no_supabase" };
  const { data, error } = await supabase
    .from("support_tickets").select("*")
    .order("created_at", { ascending: false }).limit(200);
  if (error) return { tickets: [], error: error.message };
  return { tickets: data || [], error: null };
}

export async function updateTicket(ticketId, { status, adminNotes }) {
  if (!supabase) return { error: "no_supabase" };
  const patch = { updated_at: new Date().toISOString() };
  if (status     !== undefined) patch.status      = status;
  if (adminNotes !== undefined) patch.admin_notes = adminNotes;
  const { error } = await supabase.from("support_tickets").update(patch).eq("id", ticketId);
  if (error) return { error: error.message };
  return { success: true };
}

export async function fetchAllAdmins() {
  if (!supabase) return { admins: [], error: "no_supabase" };
  const { data, error } = await supabase.from("app_admins").select("*").order("granted_at");
  if (error) return { admins: [], error: error.message };
  return { admins: data || [], error: null };
}

export async function grantAdminRole(userEmail, role, notes = "") {
  if (!supabase) return { error: "no_supabase" };
  const grantedBy = (await supabase.auth.getUser())?.data?.user?.id;
  // Look up user_id by email via auth.users (requires service role in prod;
  // in practice the invited user must have signed up first)
  const { data: users } = await supabase.rpc("get_user_id_by_email", { email: userEmail }).single().catch(() => ({ data: null }));
  const userId = users?.id || null;
  const { error } = await supabase.from("app_admins").insert({
    user_id: userId, user_email: userEmail, admin_role: role,
    granted_by: grantedBy, notes,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function revokeAdminRole(adminId) {
  if (!supabase) return false;
  const { error } = await supabase.from("app_admins").delete().eq("id", adminId);
  return !error;
}