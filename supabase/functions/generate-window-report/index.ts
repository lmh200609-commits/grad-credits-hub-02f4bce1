// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STATUS_LABEL: Record<string, string> = {
  pending_ai: "AI 评估中",
  pending_review: "待教师复核",
  auto_approved: "系统通过",
  approved: "人工通过",
  rejected_by_ai: "系统驳回",
  rejected: "人工驳回",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { window_id } = await req.json();
    if (!window_id) return json({ error: "window_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 鉴权：允许 service_role 自动调用，或 admin/super_admin 手动调用
    const authHeader = req.headers.get("Authorization") ?? "";
    let actorId: string | null = null;
    if (authHeader && !authHeader.includes(SERVICE_ROLE)) {
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: u } = await userClient.auth.getUser();
      if (!u?.user) return json({ error: "unauthorized" }, 401);
      actorId = u.user.id;
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", actorId);
      const ok = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "super_admin");
      if (!ok) return json({ error: "forbidden" }, 403);
    }

    // 1. 取窗口
    const { data: win, error: winErr } = await admin
      .from("submission_windows").select("*").eq("id", window_id).single();
    if (winErr || !win) return json({ error: "window not found" }, 404);

    const collegeId = win.college_id;
    const startsAt = win.starts_at;
    const endsAt = win.ends_at;

    // 2. 取学院学生
    const { data: studentRoles } = await admin
      .from("user_roles").select("user_id").eq("role", "student").eq("college_id", collegeId);
    const studentIds = (studentRoles ?? []).map((r: any) => r.user_id);

    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, student_no, department, class_name, major")
      .in("user_id", studentIds.length ? studentIds : ["00000000-0000-0000-0000-000000000000"]);
    const profileMap = new Map<string, any>((profiles ?? []).map((p: any) => [p.user_id, p]));

    // 3. 取窗口内的申请
    const { data: apps } = await admin
      .from("applications")
      .select("id, student_id, status, description, selected_keywords, custom_keywords, ai_suggested_credit, ai_confidence, final_credit, ai_matched_rule_id, submitted_at, reviewed_at")
      .eq("college_id", collegeId)
      .gte("submitted_at", startsAt)
      .lte("submitted_at", endsAt)
      .order("submitted_at", { ascending: true });

    const appList = (apps ?? []) as any[];

    // 规则名称
    const ruleIds = Array.from(new Set(appList.map((a) => a.ai_matched_rule_id).filter(Boolean)));
    const { data: rules } = await admin.from("rules").select("id, name, credit").in("id", ruleIds.length ? ruleIds : ["00000000-0000-0000-0000-000000000000"]);
    const ruleMap = new Map<string, any>((rules ?? []).map((r: any) => [r.id, r]));

    // 4. 学生级汇总
    const byStudent = new Map<string, any>();
    studentIds.forEach((sid) => {
      const p = profileMap.get(sid) ?? {};
      byStudent.set(sid, {
        student_id: sid,
        student_no: p.student_no ?? "",
        full_name: p.full_name ?? "",
        department: p.department ?? "",
        class_name: p.class_name ?? "",
        submitted_count: 0,
        approved_count: 0,
        rejected_count: 0,
        pending_count: 0,
        total_credit: 0,
      });
    });
    appList.forEach((a) => {
      const s = byStudent.get(a.student_id);
      if (!s) return;
      s.submitted_count += 1;
      if (a.status === "approved" || a.status === "auto_approved") {
        s.approved_count += 1;
        s.total_credit += Number(a.final_credit ?? a.ai_suggested_credit ?? 0);
      } else if (a.status === "rejected" || a.status === "rejected_by_ai") {
        s.rejected_count += 1;
      } else {
        s.pending_count += 1;
      }
    });

    const studentSummary = Array.from(byStudent.values());
    const notSubmitted = studentSummary.filter((s) => s.submitted_count === 0);

    // 5. 申请明细
    const detail = appList.map((a) => {
      const p = profileMap.get(a.student_id) ?? {};
      const r = a.ai_matched_rule_id ? ruleMap.get(a.ai_matched_rule_id) : null;
      return {
        student_no: p.student_no ?? "",
        full_name: p.full_name ?? "",
        department: p.department ?? "",
        class_name: p.class_name ?? "",
        status: STATUS_LABEL[a.status] ?? a.status,
        ai_suggested_credit: a.ai_suggested_credit ?? "",
        ai_confidence: a.ai_confidence ?? "",
        final_credit: a.final_credit ?? "",
        matched_rule: r?.name ?? "",
        keywords: [...(a.selected_keywords ?? []), ...(a.custom_keywords ?? [])].join("; "),
        description: a.description ?? "",
        submitted_at: a.submitted_at,
        reviewed_at: a.reviewed_at ?? "",
      };
    });

    // 6. 图表数据
    const statusDist: Record<string, number> = {};
    const dailyTrend: Record<string, number> = {};
    const ruleTop: Record<string, number> = {};
    const deptDist: Record<string, number> = {};
    appList.forEach((a) => {
      const lbl = STATUS_LABEL[a.status] ?? a.status;
      statusDist[lbl] = (statusDist[lbl] ?? 0) + 1;
      const day = (a.submitted_at as string).slice(0, 10);
      dailyTrend[day] = (dailyTrend[day] ?? 0) + 1;
      const rn = a.ai_matched_rule_id ? (ruleMap.get(a.ai_matched_rule_id)?.name ?? "未匹配") : "未匹配";
      ruleTop[rn] = (ruleTop[rn] ?? 0) + 1;
      const p = profileMap.get(a.student_id);
      const d = p?.department || "未填写";
      deptDist[d] = (deptDist[d] ?? 0) + 1;
    });

    const summary = {
      window: { id: win.id, name: win.name, starts_at: startsAt, ends_at: endsAt },
      kpi: {
        total_students: studentIds.length,
        submitted_students: studentSummary.filter((s) => s.submitted_count > 0).length,
        not_submitted: notSubmitted.length,
        total_applications: appList.length,
        total_credit: studentSummary.reduce((s, x) => s + x.total_credit, 0),
      },
      status_distribution: statusDist,
      daily_trend: dailyTrend,
      rule_top: ruleTop,
      dept_distribution: deptDist,
    };

    // 7. 生成 Excel
    const wb = XLSX.utils.book_new();

    const kpiRows = [
      ["批次", win.name],
      ["开始时间", new Date(startsAt).toLocaleString("zh-CN")],
      ["结束时间", new Date(endsAt).toLocaleString("zh-CN")],
      [],
      ["学院学生总数", summary.kpi.total_students],
      ["已提交学生数", summary.kpi.submitted_students],
      ["未提交学生数", summary.kpi.not_submitted],
      ["申请总数", summary.kpi.total_applications],
      ["累计通过学分", summary.kpi.total_credit],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiRows), "汇总");

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(studentSummary), "学生汇总");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "申请明细");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(notSubmitted), "未提交名单");

    const chartSheet = [
      ["状态分布"],
      ...Object.entries(statusDist).map(([k, v]) => [k, v]),
      [],
      ["每日提交趋势"],
      ...Object.entries(dailyTrend).sort().map(([k, v]) => [k, v]),
      [],
      ["规则匹配 Top"],
      ...Object.entries(ruleTop).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 20).map(([k, v]) => [k, v]),
      [],
      ["院系分布"],
      ...Object.entries(deptDist).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([k, v]) => [k, v]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(chartSheet), "图表数据");

    const xlsxBuf: Uint8Array = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    const filePath = `reports/${collegeId}/${window_id}-${Date.now()}.xlsx`;
    const { error: upErr } = await admin.storage.from("application-files").upload(filePath, xlsxBuf, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
    if (upErr) throw upErr;

    // 8. 写入 reports 表 + 更新 window
    await admin.from("submission_window_reports").insert({
      window_id, college_id: collegeId, summary, file_path: filePath, generated_by: actorId,
    });
    await admin.from("submission_windows").update({
      report_generated_at: new Date().toISOString(),
      report_path: filePath,
    }).eq("id", window_id);

    const { data: signed } = await admin.storage.from("application-files").createSignedUrl(filePath, 300);

    return json({ ok: true, file_path: filePath, download_url: signed?.signedUrl, summary }, 200);
  } catch (e: any) {
    console.error("generate-window-report error", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}