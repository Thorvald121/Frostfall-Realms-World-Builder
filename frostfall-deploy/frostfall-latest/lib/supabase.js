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

// === HELPER: Fetch user's worlds ===
export async function fetchWorlds(userId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("worlds")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) { console.error("Fetch worlds error:", error); return []; }
  return data;
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
