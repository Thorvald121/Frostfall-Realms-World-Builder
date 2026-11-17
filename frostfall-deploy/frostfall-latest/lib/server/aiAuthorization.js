import { createClient } from "@supabase/supabase-js";

/**
 * AI is always authenticated, even with BYOK. Public client sessions alone
 * are not proof of identity: getUser validates the bearer against Auth.
 * No authentication bypass is allowed in hosted or local dev mode.
 */
export async function authorizeAiRequest(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = request.headers.get("authorization") || "";
  const bearer = /^Bearer (\S+)$/i.exec(auth)?.[1];
  if (!url || !anonKey || !bearer) return { ok: false, status: 401, message: "Sign in to use AI features." };
  try {
    const client = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data, error } = await client.auth.getUser(bearer);
    if (error || !data?.user?.id) return { ok: false, status: 401, message: "Session expired. Sign in again." };
    return { ok: true, userId: data.user.id };
  } catch {
    return { ok: false, status: 503, message: "Authentication is temporarily unavailable." };
  }
}
