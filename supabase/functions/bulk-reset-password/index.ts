// Admin/Teacher: bulk reset passwords to default = student_no + last6(id_card)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function defaultPassword(studentNo: string | null, idCard: string | null, email: string | null): string {
  const prefix = (studentNo && studentNo.trim()) || (email ? email.split("@")[0] : "user");
  const tail = idCard && idCard.length >= 6 ? idCard.slice(-6) : "000000";
  let pwd = `${prefix}${tail}`;
  if (pwd.length < 8) pwd = (pwd + "00000000").slice(0, 8);
  return pwd;
}

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
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: callerId, _role: "admin" });
    const { data: isTeacher } = await admin.rpc("has_role", { _user_id: callerId, _role: "teacher" });
    if (!isAdmin && !isTeacher) return json({ error: "Forbidden" }, 403);

    const body = await req.json();
    const ids: string[] = Array.isArray(body?.user_ids) ? body.user_ids.filter((x: unknown) => typeof x === "string") : [];
    if (ids.length === 0) return json({ error: "user_ids 必填" }, 400);
    if (ids.length > 200) return json({ error: "单次最多 200 条" }, 400);

    // Teacher 仅可重置 student
    if (!isAdmin) {
      const { data: studentRoles } = await admin
        .from("user_roles").select("user_id").eq("role", "student").in("user_id", ids);
      const allowed = new Set((studentRoles ?? []).map((r) => r.user_id));
      for (const id of ids) if (!allowed.has(id)) return json({ error: "教师仅可重置学生密码" }, 403);
    }

    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, student_no, id_card, email")
      .in("user_id", ids);
    const pmap = new Map((profiles ?? []).map((p) => [p.user_id, p]));

    const results: Array<{ user_id: string; ok: boolean; password?: string; label: string; error?: string }> = [];
    let success = 0, failure = 0;
    for (const uid of ids) {
      const p = pmap.get(uid);
      const pwd = defaultPassword(p?.student_no ?? null, p?.id_card ?? null, p?.email ?? null);
      const label = p?.full_name || p?.student_no || p?.email || uid;
      const { error } = await admin.auth.admin.updateUserById(uid, { password: pwd });
      if (error) { failure++; results.push({ user_id: uid, ok: false, label, error: error.message }); }
      else { success++; results.push({ user_id: uid, ok: true, label, password: pwd }); }
    }

    await admin.from("audit_logs").insert({
      action: "bulk_reset_password",
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
    console.error("bulk-reset-password error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}