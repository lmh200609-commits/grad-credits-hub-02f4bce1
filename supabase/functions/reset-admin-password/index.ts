// Super-admin only: reset a college admin's password.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimErr } = await userClient.auth.getClaims(token);
    if (claimErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const callerId = claims.claims.sub as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: superRow } = await admin.from("user_roles")
      .select("role").eq("user_id", callerId).eq("role", "super_admin").maybeSingle();
    if (!superRow) return json({ error: "Forbidden: super_admin only" }, 403);

    const { user_id, password } = await req.json() as { user_id: string; password: string };
    if (!user_id || !password || password.length < 6) {
      return json({ error: "缺少 user_id 或密码长度 < 6" }, 400);
    }

    const { error } = await admin.auth.admin.updateUserById(user_id, { password });
    if (error) return json({ error: `重置失败: ${error.message}` }, 400);
    return json({ success: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});