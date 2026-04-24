// Admin-only: delete a user account (auth + profile + roles cascade by FKs/cleanup)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const { data: claims, error: claimErr } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const callerId = claims.claims.sub as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: callerId,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "Forbidden：仅管理员可删除账号" }, 403);

    const { user_id } = await req.json();
    if (!user_id || typeof user_id !== "string") {
      return json({ error: "user_id 必填" }, 400);
    }
    if (user_id === callerId) return json({ error: "不能删除自己的账号" }, 400);

    // Snapshot profile for audit before delete
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, student_no, email")
      .eq("user_id", user_id)
      .maybeSingle();

    // Clean up app data first to avoid orphaned references
    await admin.from("user_roles").delete().eq("user_id", user_id);
    await admin.from("profiles").delete().eq("user_id", user_id);

    const { error } = await admin.auth.admin.deleteUser(user_id);
    if (error) return json({ error: error.message }, 500);

    // Best-effort audit
    const label = profile?.full_name || profile?.student_no || profile?.email || user_id;
    await admin.from("audit_logs").insert({
      action: "delete_user",
      actor_id: callerId,
      target_ids: [user_id],
      target_labels: [label],
      success_count: 1,
      affected_count: 1,
      metadata: { profile },
    }).then(() => {}, () => {});

    return json({ success: true });
  } catch (e) {
    console.error("delete-user error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}