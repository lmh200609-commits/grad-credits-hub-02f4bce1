// Admin-only: bulk delete user accounts
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
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (!claims?.claims) return json({ error: "Unauthorized" }, 401);
    const callerId = claims.claims.sub as string;
    const callerEmail = (claims.claims.email as string | undefined) ?? null;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: callerRoles, error: roleErr } = await admin
      .from("user_roles")
      .select("role,college_id")
      .eq("user_id", callerId)
      .in("role", ["admin", "super_admin"]);
    if (roleErr) return json({ error: roleErr.message }, 500);
    const canDelete = (callerRoles ?? []).some((r) => r.role === "admin" || r.role === "super_admin");
    if (!canDelete) return json({ error: "Forbidden：仅管理员可删除账号" }, 403);
    const isSuper = (callerRoles ?? []).some((r) => r.role === "super_admin");
    const callerCollegeIds = new Set(
      (callerRoles ?? []).map((r: any) => r.college_id).filter(Boolean) as string[],
    );

    const body = await req.json();
    let ids: string[] = Array.isArray(body?.user_ids) ? body.user_ids.filter((x: unknown) => typeof x === "string") : [];
    if (ids.length === 0) return json({ error: "user_ids 必填" }, 400);
    if (ids.length > 200) return json({ error: "单次最多 200 条" }, 400);
    if (ids.includes(callerId)) {
      return json({ error: "不能删除当前登录账号，请先取消勾选自己的账号" }, 400);
    }

    if (!isSuper) {
      const { data: targetRoles } = await admin
        .from("user_roles").select("user_id,college_id").in("user_id", ids);
      const collegesByUser = new Map<string, string[]>();
      for (const r of (targetRoles ?? [])) {
        const arr = collegesByUser.get(r.user_id) ?? [];
        if (r.college_id) arr.push(r.college_id);
        collegesByUser.set(r.user_id, arr);
      }
      for (const id of ids) {
        const cs = collegesByUser.get(id) ?? [];
        if (!cs.some((cid) => callerCollegeIds.has(cid))) {
          return json({ error: "Forbidden: cross-college" }, 403);
        }
      }
    }

    const { data: profiles } = await admin
      .from("profiles").select("user_id, full_name, student_no, email").in("user_id", ids);
    const labelMap = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name || p.student_no || p.email || p.user_id]));

    const results: Array<{ user_id: string; ok: boolean; label: string; error?: string }> = [];
    let success = 0, failure = 0;
    for (const uid of ids) {
      const label = (labelMap.get(uid) as string) || uid;
      try {
        await admin.from("user_roles").delete().eq("user_id", uid);
        await admin.from("profiles").delete().eq("user_id", uid);
        const { error } = await admin.auth.admin.deleteUser(uid);
        if (error) throw error;
        success++; results.push({ user_id: uid, ok: true, label });
      } catch (e) {
        failure++; results.push({ user_id: uid, ok: false, label, error: (e as Error).message });
      }
    }

    await admin.from("audit_logs").insert({
      action: "bulk_delete_users",
      actor_id: callerId,
      actor_email: callerEmail,
      target_ids: ids,
      target_labels: results.map((r) => r.label),
      affected_count: ids.length,
      success_count: success,
      failure_count: failure,
      metadata: { errors: results.filter((r) => !r.ok).map((r) => ({ user_id: r.user_id, error: r.error })) },
    }).then(() => {}, () => {});

    return json({ success: true, results, success_count: success, failure_count: failure });
  } catch (e) {
    console.error("bulk-delete-users error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}