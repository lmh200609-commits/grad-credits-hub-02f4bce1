// Admin batch import: validates rows, creates auth users + profiles + roles.
// Supports large batches (2000+) via parallel processing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CONCURRENCY = 10; // parallel user creation within a batch
const BATCH_SIZE = 200; // chunk size to avoid Auth API burst limits

type Row = {
  student_no: string;
  full_name: string;
  phone?: string;
  class_name?: string;
  department?: string;
  major?: string;
  role: "admin" | "teacher" | "student";
  password: string;
  gender?: string;
  ethnicity?: string;
  political_status?: string;
  birth_date?: string;
  enrollment_year?: number;
  advisor?: string;
  apartment_no?: string;
  dorm_room?: string;
  bed_no?: string;
};

async function createOneUser(
  admin: ReturnType<typeof createClient>,
  r: Row,
  idx: number,
): Promise<{ user_id: string; student_no: string }> {
  const sno = r.student_no.trim();
  // 合成邮箱必须只包含 ASCII 字母/数字/.-_，否则 Supabase Auth 会拒绝
  const localPart = sno.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!localPart) {
    throw new Error(`第 ${idx + 2} 行创建账号失败: 学号「${sno}」无法生成有效邮箱（请使用字母数字）`);
  }
  const email = `${localPart}@admin.local`;

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
  if (ce) throw new Error(`第 ${idx + 2} 行创建账号失败: ${ce.message}`);
  const uid = u.user!.id;

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
      gender: r.gender?.trim() || null,
      ethnicity: r.ethnicity?.trim() || null,
      political_status: r.political_status?.trim() || null,
      birth_date: r.birth_date?.trim() || null,
      enrollment_year: typeof r.enrollment_year === "number" ? r.enrollment_year : null,
      advisor: r.advisor?.trim() || null,
      apartment_no: r.apartment_no?.trim() || null,
      dorm_room: r.dorm_room?.trim() || null,
      bed_no: r.bed_no?.trim() || null,
    })
    .eq("user_id", uid);
  if (pe) throw new Error(`第 ${idx + 2} 行写入档案失败: ${pe.message}`);

  const { error: re } = await admin
    .from("user_roles")
    .insert({ user_id: uid, role: r.role });
  if (re) throw new Error(`第 ${idx + 2} 行分配角色失败: ${re.message}`);

  return { user_id: uid, student_no: sno };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

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
    const fileName = (body.file_name as string) ?? null;
    const startedAt = Date.now();
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ error: "rows must be a non-empty array" }, 400);
    }

    // Validate
    const errors: { line: number; message: string }[] = [];
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const line = i + 2;
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

    // Check existing student_nos (batch query in chunks of 500 to avoid query limits)
    const studentNos = rows.map((r) => r.student_no.trim());
    const allConflicts: string[] = [];
    for (let i = 0; i < studentNos.length; i += 500) {
      const chunk = studentNos.slice(i, i + 500);
      const { data: existing } = await admin
        .from("profiles")
        .select("student_no")
        .in("student_no", chunk);
      if (existing?.length) allConflicts.push(...existing.map((e) => e.student_no));
    }
    const skipExisting = body.skip_existing === true;
    let skippedRows: string[] = [];
    let workingRows = rows;
    if (allConflicts.length > 0) {
      if (!skipExisting) {
        return json({
          error: `存在已导入的学号/工号（${allConflicts.length}个），整批中止。可在前端勾选「跳过已存在」后重新提交，或先在学生管理中删除冲突账号。`,
          conflicts: allConflicts.slice(0, 50),
          can_skip: true,
        }, 409);
      }
      const conflictSet = new Set(allConflicts);
      skippedRows = [...conflictSet];
      workingRows = rows.filter((r) => !conflictSet.has(r.student_no.trim()));
      if (workingRows.length === 0) {
        return json({
          error: "所有学号都已存在，没有新账号需要创建",
          conflicts: allConflicts.slice(0, 50),
          skipped: skippedRows.length,
        }, 409);
      }
    }

    // Create users: chunk into BATCH_SIZE groups (sequential), each chunk runs CONCURRENCY in parallel.
    const partial = body.partial === true;
    const created: { user_id: string; student_no: string }[] = [];
    const failures: { line: number; message: string; student_no?: string }[] = [];
    try {
      for (let cStart = 0; cStart < rows.length; cStart += BATCH_SIZE) {
        const chunk = rows.slice(cStart, cStart + BATCH_SIZE);
        console.log(`[import-users] chunk ${cStart}-${cStart + chunk.length} / ${rows.length}`);
        for (let i = 0; i < chunk.length; i += CONCURRENCY) {
          const batch = chunk.slice(i, i + CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map((r, j) => createOneUser(admin, r, cStart + i + j)),
          );
          results.forEach((res, j) => {
            const absIdx = cStart + i + j;
            if (res.status === "fulfilled") {
              created.push(res.value);
            } else {
              const msg = (res.reason as Error)?.message ?? "未知错误";
              failures.push({
                line: absIdx + 2,
                message: msg,
                student_no: batch[j].student_no,
              });
              if (!partial) throw res.reason;
            }
          });
        }
      }
    } catch (e) {
      // Rollback all created users in parallel
      const rollbackBatch = 20;
      for (let i = 0; i < created.length; i += rollbackBatch) {
        await Promise.all(
          created.slice(i, i + rollbackBatch).map((c) =>
            admin.auth.admin.deleteUser(c.user_id).catch(() => {})
          ),
        );
      }
      await admin.from("audit_logs").insert({
        action: "import_users",
        actor_id: callerId,
        actor_email: claims.claims.email ?? null,
        target_ids: [],
        target_labels: [],
        affected_count: rows.length,
        success_count: 0,
        failure_count: rows.length,
        duration_ms: Date.now() - startedAt,
        metadata: {
          file_name: fileName,
          rolled_back: created.length,
          error: (e as Error).message,
        },
      }).then(() => {}, () => {});
      return json({ error: (e as Error).message, rolled_back: created.length }, 500);
    }

    await admin.from("audit_logs").insert({
      action: "import_users",
      actor_id: callerId,
      actor_email: claims.claims.email ?? null,
      target_ids: created.map((c) => c.user_id),
      target_labels: created.map((c) => c.student_no),
      affected_count: rows.length,
      success_count: created.length,
      failure_count: failures.length,
      duration_ms: Date.now() - startedAt,
      metadata: {
        file_name: fileName,
        partial,
        failures: failures.slice(0, 50),
      },
    }).then(() => {}, () => {});

    return json({
      success: true,
      created: created.length,
      failed: failures.length,
      failures: failures.slice(0, 100),
    });
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
