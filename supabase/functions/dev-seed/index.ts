// Dev-only seed: creates 5 fixed test accounts (idempotent).
// Accounts: 2024001 白雪/student, 2024002 李明/student, 2024003 王芳/student,
//           T001 张老师/teacher, A001 系统管理员二号/admin
// Password for all: Test1234
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Seed = {
  student_no: string;
  full_name: string;
  role: "admin" | "teacher" | "student";
  department?: string;
  major?: string;
  class_name?: string;
};

const SEEDS: Seed[] = [
  { student_no: "2024001", full_name: "白雪", role: "student", department: "计算机学院", major: "软件工程", class_name: "软工2401" },
  { student_no: "2024002", full_name: "李明", role: "student", department: "计算机学院", major: "计算机科学", class_name: "计科2401" },
  { student_no: "2024003", full_name: "王芳", role: "student", department: "外国语学院", major: "英语", class_name: "英语2401" },
  { student_no: "T001", full_name: "张老师", role: "teacher", department: "计算机学院" },
  { student_no: "A001", full_name: "测试管理员", role: "admin" },
];

const PASSWORD = "Test1234";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const results: { email: string; status: string }[] = [];

    for (const s of SEEDS) {
      const email = `${s.student_no}@admin.local`;

      // Check if profile already exists
      const { data: existing } = await admin
        .from("profiles")
        .select("user_id")
        .eq("student_no", s.student_no)
        .maybeSingle();

      let userId: string;
      if (existing?.user_id) {
        userId = existing.user_id;
        // Reset password so it always matches
        await admin.auth.admin.updateUserById(userId, { password: PASSWORD });
        results.push({ email, status: "exists, password reset" });
      } else {
        const { data: u, error: ce } = await admin.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
          user_metadata: { full_name: s.full_name, student_no: s.student_no },
        });
        if (ce) {
          results.push({ email, status: `create failed: ${ce.message}` });
          continue;
        }
        userId = u.user!.id;
        results.push({ email, status: "created" });
      }

      // Upsert profile
      await admin.from("profiles").update({
        full_name: s.full_name,
        student_no: s.student_no,
        department: s.department ?? null,
        major: s.major ?? null,
        class_name: s.class_name ?? null,
        email,
      }).eq("user_id", userId);

      // Ensure role
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("id")
        .eq("user_id", userId)
        .eq("role", s.role)
        .maybeSingle();
      if (!roleRow) {
        await admin.from("user_roles").insert({ user_id: userId, role: s.role });
      }
    }

    return new Response(JSON.stringify({ success: true, password: PASSWORD, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
