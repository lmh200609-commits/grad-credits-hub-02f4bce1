// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
const PASS_THRESHOLD = 4;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { window_id } = await req.json();
    if (!window_id) return json({ error: "window_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const authHeader = req.headers.get("Authorization") ?? "";
    let actorId: string | null = null;
    let actorEmail: string | null = null;
    if (authHeader && !authHeader.includes(SERVICE_ROLE)) {
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: u } = await userClient.auth.getUser();
      if (!u?.user) return json({ error: "unauthorized" }, 401);
      actorId = u.user.id; actorEmail = u.user.email ?? null;
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", actorId);
      const ok = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "super_admin");
      if (!ok) return json({ error: "forbidden" }, 403);
    }

    const { data: win, error: winErr } = await admin
      .from("submission_windows").select("*").eq("id", window_id).single();
    if (winErr || !win) return json({ error: "window not found" }, 404);

    const collegeId = win.college_id;
    const { data: collegeRow } = await admin
      .from("colleges").select("name").eq("id", collegeId).maybeSingle();
    const collegeName = collegeRow?.name ?? "学院";

    const { data: studentRoles } = await admin
      .from("user_roles").select("user_id").eq("role", "student").eq("college_id", collegeId);
    const studentIds = (studentRoles ?? []).map((r: any) => r.user_id);

    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, student_no, department, class_name, major")
      .in("user_id", studentIds.length ? studentIds : ["00000000-0000-0000-0000-000000000000"]);
    const profileMap = new Map<string, any>((profiles ?? []).map((p: any) => [p.user_id, p]));

    const { data: apps } = await admin
      .from("applications")
      .select("id, student_id, status, description, ai_suggested_credit, final_credit, ai_matched_rule_id, submitted_at")
      .eq("college_id", collegeId)
      .gte("submitted_at", win.starts_at)
      .lte("submitted_at", win.ends_at)
      .order("submitted_at", { ascending: true });
    const appList = (apps ?? []) as any[];

    const ruleIds = Array.from(new Set(appList.map((a) => a.ai_matched_rule_id).filter(Boolean)));
    const { data: rules } = await admin.from("rules").select("id, name")
      .in("id", ruleIds.length ? ruleIds : ["00000000-0000-0000-0000-000000000000"]);
    const ruleMap = new Map<string, any>((rules ?? []).map((r: any) => [r.id, r]));

    type StuAgg = {
      student_id: string; student_no: string; full_name: string;
      department: string; class_name: string; major: string;
      submitted: number; approved: number; rejected: number; pending: number; total_credit: number;
    };
    const byStu = new Map<string, StuAgg>();
    studentIds.forEach((sid) => {
      const p = profileMap.get(sid) ?? {};
      byStu.set(sid, {
        student_id: sid,
        student_no: p.student_no ?? "", full_name: p.full_name ?? "",
        department: p.department ?? "未填写", class_name: p.class_name ?? "未填写",
        major: p.major ?? "未填写",
        submitted: 0, approved: 0, rejected: 0, pending: 0, total_credit: 0,
      });
    });
    appList.forEach((a) => {
      const s = byStu.get(a.student_id);
      if (!s) return;
      s.submitted += 1;
      if (a.status === "approved" || a.status === "auto_approved") {
        s.approved += 1;
        s.total_credit += Number(a.final_credit ?? a.ai_suggested_credit ?? 0);
      } else if (a.status === "rejected" || a.status === "rejected_by_ai") s.rejected += 1;
      else s.pending += 1;
    });
    const stuList = Array.from(byStu.values());

    const totalStudents = stuList.length;
    const submittedStudents = stuList.filter((s) => s.submitted > 0).length;
    const notSubmitted = stuList.filter((s) => s.submitted === 0);
    const totalApps = appList.length;
    const appApproved = appList.filter((a) => a.status === "approved" || a.status === "auto_approved").length;
    const appRejected = appList.filter((a) => a.status === "rejected" || a.status === "rejected_by_ai").length;
    const appPending = totalApps - appApproved - appRejected;
    const totalCredit = stuList.reduce((s, x) => s + x.total_credit, 0);
    // 口径：全体学生（含未提交）中，total_credit < 阈值 即不合格
    const passN = (th: number) => stuList.filter((s) => s.total_credit >= th).length;
    const passMain = passN(PASS_THRESHOLD);
    const failMain = totalStudents - passMain;

    const statusDist: Record<string, number> = {};
    appList.forEach((a) => {
      const lbl = STATUS_LABEL[a.status] ?? a.status;
      statusDist[lbl] = (statusDist[lbl] ?? 0) + 1;
    });

    const dayMap: Record<string, number> = {};
    appList.forEach((a) => { const d = (a.submitted_at as string).slice(0, 10); dayMap[d] = (dayMap[d] ?? 0) + 1; });
    const trend: { date: string; count: number }[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(today); dt.setDate(today.getDate() - i);
      const k = dt.toISOString().slice(0, 10);
      trend.push({ date: k.slice(5), count: dayMap[k] ?? 0 });
    }

    const groupBy = (arr: StuAgg[], k: (s: StuAgg) => string) => {
      const m = new Map<string, StuAgg[]>();
      arr.forEach((s) => { const key = k(s) || "未填写"; if (!m.has(key)) m.set(key, []); m.get(key)!.push(s); });
      return m;
    };
    const aggGroup = (ss: StuAgg[]) => {
      const total = ss.length;
      const submitted = ss.filter((s) => s.submitted > 0).length;
      const approved = ss.reduce((a, s) => a + s.approved, 0);
      const rejected = ss.reduce((a, s) => a + s.rejected, 0);
      const pending = ss.reduce((a, s) => a + s.pending, 0);
      const credit = ss.reduce((a, s) => a + s.total_credit, 0);
      const passC = ss.filter((s) => s.total_credit >= PASS_THRESHOLD).length;
      return {
        total, submitted, not_sub: total - submitted, approved, rejected, pending,
        credit, avg: total > 0 ? credit / total : 0,
        pass_c: passC, fail_c: total - passC,
      };
    };

    const deptDist = Array.from(groupBy(stuList, (s) => s.department).entries())
      .map(([k, v]) => ({ name: k, ...aggGroup(v) }))
      .sort((a, b) => b.total - a.total);
    const majorDist = Array.from(groupBy(stuList, (s) => s.major).entries())
      .map(([k, v]) => ({ name: k, ...aggGroup(v) }))
      .sort((a, b) => b.total - a.total);
    const classMap = groupBy(stuList, (s) => s.class_name);
    const classDist = Array.from(classMap.entries()).map(([k, v]) => ({
      name: k, major: v[0]?.major ?? "", ...aggGroup(v),
    })).sort((a, b) => b.total - a.total);

    const failClasses = classDist.map((e) => {
      const fails = (classMap.get(e.name) ?? [])
        .filter((s) => s.total_credit < PASS_THRESHOLD)
        .map((s) => ({
          student_no: s.student_no, full_name: s.full_name,
          submitted: s.submitted, approved: s.approved, rejected: s.rejected, pending: s.pending,
          total_credit: s.total_credit, gap: PASS_THRESHOLD - s.total_credit,
          not_submitted: s.submitted === 0,
        }))
        .sort((a, b) => b.gap - a.gap);
      return {
        class: e.name, major: e.major, total: e.total,
        submitted: e.submitted, pass_c: e.pass_c, fail_c: e.fail_c, not_sub: e.not_sub,
        fails,
      };
    }).filter((e) => e.fails.length > 0);

    const missMap = new Map<string, any[]>();
    notSubmitted.forEach((s) => {
      const k = s.class_name || "未填写";
      if (!missMap.has(k)) missMap.set(k, []);
      missMap.get(k)!.push({
        student_no: s.student_no, full_name: s.full_name, major: s.major, department: s.department,
      });
    });
    const missClasses = Array.from(missMap.entries())
      .map(([cls, list]) => ({ class: cls, list }))
      .sort((a, b) => b.list.length - a.list.length);

    const details = appList.map((a) => {
      const p = profileMap.get(a.student_id) ?? {};
      const r = a.ai_matched_rule_id ? ruleMap.get(a.ai_matched_rule_id) : null;
      return {
        submitted_at: a.submitted_at,
        student_no: p.student_no ?? "", full_name: p.full_name ?? "", class_name: p.class_name ?? "",
        status: a.status, status_label: STATUS_LABEL[a.status] ?? a.status,
        rule_name: r?.name ?? "",
        ai_suggested_credit: a.ai_suggested_credit,
        final_credit: a.final_credit,
        description: (a.description ?? "").replace(/\s+/g, " ").slice(0, 80),
      };
    });

    const summary = {
      version: 2,
      generated_at: new Date().toISOString(),
      generated_by: actorEmail,
      college: { id: collegeId, name: collegeName },
      window: { id: win.id, name: win.name, starts_at: win.starts_at, ends_at: win.ends_at },
      pass_threshold: PASS_THRESHOLD,
      kpi: {
        total_students: totalStudents,
        submitted_students: submittedStudents,
        not_submitted: notSubmitted.length,
        total_applications: totalApps,
        approved: appApproved, rejected: appRejected, pending: appPending,
        total_credit: totalCredit, pass: passMain, fail: failMain,
      },
      pass_tiers: [
        { th: 2, pass: passN(2), fail: totalStudents - passN(2) },
        { th: PASS_THRESHOLD, pass: passMain, fail: failMain },
        { th: 6, pass: passN(6), fail: totalStudents - passN(6) },
      ],
      status_distribution: statusDist,
      daily_trend: trend,
      dept_distribution: deptDist,
      major_distribution: majorDist,
      class_distribution: classDist,
      fail_classes: failClasses,
      miss_classes: missClasses,
      details,
    };

    await admin.from("submission_window_reports").insert({
      window_id, college_id: collegeId, summary, file_path: null, generated_by: actorId,
    });
    const reportRoute = `/admin/window-report/${window_id}`;
    await admin.from("submission_windows").update({
      report_generated_at: new Date().toISOString(), report_path: reportRoute,
    }).eq("id", window_id);

    return json({ ok: true, report_route: reportRoute, summary }, 200);
  } catch (e: any) {
    console.error("generate-window-report error", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
