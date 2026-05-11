// Admin-only: reset another user's password
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
    const { data: callerRoles, error: roleErr } = await admin
      .from("user_roles")
      .select("role,college_id")
      .eq("user_id", callerId)
      .in("role", ["admin", "super_admin", "teacher"]);
    if (roleErr) return json({ error: roleErr.message }, 500);
    const isSuper = (callerRoles ?? []).some((r) => r.role === "super_admin");
    const isAdmin = (callerRoles ?? []).some((r) => r.role === "admin");
    const isTeacher = (callerRoles ?? []).some((r) => r.role === "teacher");
    if (!isSuper && !isAdmin && !isTeacher) return json({ error: "Forbidden" }, 403);
    const callerCollegeIds = new Set(
      (callerRoles ?? []).map((r: any) => r.college_id).filter(Boolean) as string[],
    );

    const { user_id } = await req.json();
    if (!user_id || typeof user_id !== "string") {
      return json({ error: "user_id 必填" }, 400);
    }

    // Load target roles (with college_id) to enforce both role and college scoping
    const { data: targetRoles } = await admin
      .from("user_roles")
      .select("role,college_id")
      .eq("user_id", user_id);
    const targetIsStudent = (targetRoles ?? []).some((r: any) => r.role === "student");
    if (!isSuper && !isAdmin && !targetIsStudent) {
      return json({ error: "教师仅可重置学生密码" }, 403);
    }
    if (!isSuper) {
      const targetCollegeIds = (targetRoles ?? []).map((r: any) => r.college_id).filter(Boolean) as string[];
      const sameCollege = targetCollegeIds.some((cid) => callerCollegeIds.has(cid));
      if (!sameCollege) return json({ error: "Forbidden: cross-college" }, 403);
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, student_no, id_card, email")
      .eq("user_id", user_id)
      .maybeSingle();

    const prefix = (profile?.student_no && profile.student_no.trim()) || (profile?.email ? profile.email.split("@")[0] : "user");
    const tail = profile?.id_card && profile.id_card.length >= 6 ? profile.id_card.slice(-6) : "000000";
    let password = `${prefix}${tail}`;
    if (password.length < 8) password = (password + "00000000").slice(0, 8);

    const { error } = await admin.auth.admin.updateUserById(user_id, { password });
    if (error) return json({ error: error.message }, 500);

    const label = profile?.full_name || profile?.student_no || profile?.email || user_id;
    await admin.from("audit_logs").insert({
      action: "reset_password",
      actor_id: callerId,
      target_ids: [user_id],
      target_labels: [label],
      affected_count: 1,
      success_count: 1,
    }).then(() => {}, () => {});

    return json({ success: true, password });
  } catch (e) {
    console.error("reset-password error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
