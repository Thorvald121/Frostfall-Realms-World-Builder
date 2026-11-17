import { supabase } from "../supabase";

export async function aiRequestHeaders() {
  if (!supabase) throw new Error("AI tools require a signed-in account.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error("Session expired. Sign in to use AI tools.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` };
}
