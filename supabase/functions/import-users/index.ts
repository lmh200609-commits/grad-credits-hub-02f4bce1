// Admin batch import: validates CSV rows, refuses if any 学号 already exists,
// then creates auth users + profiles + roles in one go.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Row = {
  student_no: string;
  full_name: string;
  phone?: string;
  class_name?: string;
  department?: string;
  major?: string;
  role: "admin" | "teacher" | "student";
  password: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Verify caller is admin
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
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Forbidden: admin role required" }, 403);

    const body = await req.json();
    const rows = body.rows as Row[];
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ error: "rows must be a non-empty array" }, 400);
    }

    // 1. Validate every row
    const errors: { line: number; message: string }[] = [];
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const line = i + 2; // header + 1-based
      if (!r.student_no?.trim()) errors.push({ line, message: "学号/工号为空" });
      if (!r.full_name?.trim()) errors.push({ line, message: "姓名为空" });
      if (!r.password || r.password.length < 6) errors.push({ line, message: "密码至少 6 位" });
      if (!["admin", "teacher", "student"].includes(r.role)) {
        errors.push({ line, message: `角色非法: ${r.role}` });
      }
      const key = r.student_no?.trim();
      if (key && seen.has(key)) errors.push({ line, message: `CSV 内重复学号: ${key}` });
      seen.add(key);
    });
    if (errors.length) return json({ error: "校验失败", errors }, 400);

    // 2. Check existing 学号
    const studentNos = rows.map((r) => r.student_no.trim());
    const { data: existing, error: existErr } = await admin
      .from("profiles")
      .select("student_no")
      .in("student_no", studentNos);
    if (existErr) throw existErr;
    if (existing && existing.length > 0) {
      return json(
        {
          error: "存在已导入的学号/工号，整批中止",
          conflicts: existing.map((e) => e.student_no),
        },
        409,
      );
    }

    // 3. Create users one by one (so we can rollback by tracking created ids)
    const created: { user_id: string; student_no: string }[] = [];
    try {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const sno = r.student_no.trim();
        const email = `${sno}@admin.local`;

        const { data: u, error: ce } = await admin.auth.admin.createUser({
          email,
          password: r.password,
          email_confirm: true,
          user_metadata: {
            full_name: r.full_name.trim(),
            student_no: sno,
            department: r.department?.trim() ?? null,
          },
        });
        if (ce) throw new Error(`第 ${i + 2} 行创建账号失败: ${ce.message}`);
        const uid = u.user!.id;

        // Trigger already inserted basic profile; update extra fields
        const { error: pe } = await admin
          .from("profiles")
          .update({
            full_name: r.full_name.trim(),
            student_no: sno,
            phone: r.phone?.trim() || null,
            class_name: r.class_name?.trim() || null,
            department: r.department?.trim() || null,
            major: r.major?.trim() || null,
            email,
          })
          .eq("user_id", uid);
        if (pe) throw new Error(`第 ${i + 2} 行写入档案失败: ${pe.message}`);

        const { error: re } = await admin
          .from("user_roles")
          .insert({ user_id: uid, role: r.role });
        if (re) throw new Error(`第 ${i + 2} 行分配角色失败: ${re.message}`);

        created.push({ user_id: uid, student_no: sno });
      }
    } catch (e) {
      // rollback created auth users (cascades to profiles + roles)
      for (const c of created) {
        await admin.auth.admin.deleteUser(c.user_id).catch(() => {});
      }
      return json({ error: (e as Error).message, rolled_back: created.length }, 500);
    }

    return json({ success: true, created: created.length });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
