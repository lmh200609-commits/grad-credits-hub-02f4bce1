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

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
const fmtDT = (s?: string | null) =>
  s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "";
const esc = (s: any) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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
    const passN = (th: number) => stuList.filter((s) => s.submitted > 0 && s.total_credit >= th).length;
    const failN = (th: number) => submittedStudents - passN(th);
    const passMain = passN(PASS_THRESHOLD), failMain = failN(PASS_THRESHOLD);

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
      const passC = ss.filter((s) => s.submitted > 0 && s.total_credit >= PASS_THRESHOLD).length;
      return {
        total, submitted, notSub: total - submitted, approved, rejected, pending,
        credit, avg: total > 0 ? credit / total : 0,
        passC, failC: submitted - passC,
        passRate: submitted > 0 ? passC / submitted : 0,
      };
    };
    const deptMap = groupBy(stuList, (s) => s.department);
    const majorMap = groupBy(stuList, (s) => s.major);
    const classMap = groupBy(stuList, (s) => s.class_name);

    const classEntries = Array.from(classMap.entries()).map(([k, v]) => ({
      name: k, major: v[0]?.major ?? "", a: aggGroup(v),
    })).sort((a, b) => b.a.total - a.a.total);

    const failClasses = classEntries.map((e) => {
      const fails = (classMap.get(e.name) ?? [])
        .filter((s) => s.submitted > 0 && s.total_credit < PASS_THRESHOLD)
        .map((s) => ({ ...s, gap: PASS_THRESHOLD - s.total_credit }))
        .sort((a, b) => b.gap - a.gap);
      return { ...e, fails };
    }).filter((e) => e.fails.length > 0);

    const missClasses = (() => {
      const m = new Map<string, StuAgg[]>();
      notSubmitted.forEach((s) => { const k = s.class_name || "未填写"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(s); });
      return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
    })();

    // ===== HTML =====
    const trendMax = Math.max(1, ...trend.map((t) => t.count));
    const css = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin:0; font-family: -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif; color:#1e293b; background:#f1f5f9; }
.toolbar { position:sticky; top:0; z-index:10; display:flex; gap:12px; padding:12px 24px; background:#0f172aee; backdrop-filter:blur(8px); color:#fff; }
.toolbar button { background:#3b82f6; color:#fff; border:0; padding:8px 16px; border-radius:6px; font-size:14px; cursor:pointer; font-weight:500; }
.toolbar button:hover { background:#2563eb; }
.toolbar .meta { margin-left:auto; opacity:.7; font-size:12px; align-self:center; }
.page { max-width: 980px; margin: 24px auto; background:#fff; padding:48px 56px; box-shadow:0 4px 24px rgba(15,23,42,.08); border-radius:8px; }
.cover { background:linear-gradient(135deg,#1F4E79,#3b6fa0); color:#fff; margin:-48px -56px 32px; padding:48px 56px; border-radius:8px 8px 0 0; }
.cover h1 { margin:0 0 8px; font-size:30px; letter-spacing:1px; }
.cover .sub { opacity:.85; font-size:14px; margin:4px 0; }
h2 { font-size:18px; margin:36px 0 16px; padding-left:12px; border-left:4px solid #1F4E79; color:#0f172a; }
h2 .hint { font-size:12px; color:#64748b; font-weight:400; margin-left:12px; }
.kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-top:8px; }
.kpi { border:1px solid #e2e8f0; background:#f8fafc; border-radius:8px; padding:12px 14px; }
.kpi .l { font-size:11.5px; color:#64748b; }
.kpi .v { font-size:22px; font-weight:700; color:#1F4E79; margin-top:6px; line-height:1; }
.kpi.ok .v { color:#10b981; } .kpi.bad .v { color:#ef4444; } .kpi.warn .v { color:#f59e0b; }
table { width:100%; border-collapse:collapse; font-size:12.5px; }
th { background:#1F4E79; color:#fff; font-weight:600; text-align:left; padding:8px 10px; }
td { padding:7px 10px; border-bottom:1px solid #e2e8f0; }
tbody tr:nth-child(even) td { background:#f5f8fb; }
tbody tr:hover td { background:#eef4fb; }
.pill { display:inline-block; padding:1px 8px; border-radius:10px; font-size:11px; font-weight:600; }
.pill.ok { background:#dcfce7; color:#15803d; }
.pill.bad { background:#fee2e2; color:#b91c1c; }
.pill.warn { background:#fef3c7; color:#a16207; }
.bar-row { display:grid; grid-template-columns: 130px 1fr 80px; align-items:center; gap:10px; padding:5px 0; font-size:12.5px; }
.bar { background:#e2e8f0; height:10px; border-radius:5px; overflow:hidden; }
.bar > span { display:block; height:100%; background:#1F4E79; }
.bar.ok > span { background:#10b981; } .bar.bad > span { background:#ef4444; } .bar.warn > span { background:#f59e0b; }
.fail-block { border:1px solid #fecaca; background:#fff7f7; border-radius:8px; padding:14px 16px; margin:14px 0; }
.fail-block .head { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.fail-block .head strong { color:#b91c1c; font-size:14px; }
.fail-block .head .stat { font-size:12px; color:#64748b; }
.miss-block { margin:14px 0; }
.miss-block .head { font-weight:600; margin-bottom:6px; color:#0f172a; }
.empty { color:#10b981; font-weight:600; padding:10px 0; }
.trend { display:grid; grid-template-columns:repeat(14,1fr); gap:4px; align-items:end; height:120px; padding:8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; }
.trend .col { display:flex; flex-direction:column; align-items:center; gap:4px; }
.trend .bar2 { width:100%; background:linear-gradient(to top,#1F4E79,#3b6fa0); border-radius:3px 3px 0 0; min-height:2px; }
.trend .lab { font-size:9px; color:#64748b; }
.trend .num { font-size:9px; color:#1F4E79; font-weight:600; }
@media print {
  body { background:#fff; }
  .toolbar { display:none; }
  .page { box-shadow:none; margin:0; max-width:none; padding:24px 28px; border-radius:0; }
  h2 { page-break-after:avoid; }
  table, .fail-block, .miss-block { page-break-inside:avoid; }
  thead { display:table-header-group; }
}
`;

    const kpiCard = (l: string, v: string | number, tone?: "ok" | "bad" | "warn") =>
      `<div class="kpi ${tone ?? ""}"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`;

    const statusBars = (() => {
      const max = Math.max(1, ...Object.values(statusDist));
      return Object.entries(statusDist).map(([k, v]) => {
        const tone = k.includes("通过") ? "ok" : k.includes("驳回") ? "bad" : "warn";
        return `<div class="bar-row"><span>${esc(k)}</span><div class="bar ${tone}"><span style="width:${(v / max * 100).toFixed(1)}%"></span></div><span style="text-align:right">${v} · ${pct(v, totalApps)}</span></div>`;
      }).join("") || `<div class="empty">本批次暂无申请</div>`;
    })();

    const trendHtml = `<div class="trend">${trend.map((t) =>
      `<div class="col"><div class="num">${t.count || ""}</div><div class="bar2" style="height:${(t.count / trendMax * 90).toFixed(1)}px"></div><div class="lab">${t.date}</div></div>`
    ).join("")}</div>`;

    const tbl = (head: string[], rows: (string | number)[][], opts?: { rowClass?: (i: number) => string }) =>
      `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
        (rows.length ? rows : [head.map(() => "—")]).map((r, i) =>
          `<tr${opts?.rowClass ? ` class="${opts.rowClass(i)}"` : ""}>${r.map((c) => `<td>${typeof c === "string" && c.startsWith("<") ? c : esc(c)}</td>`).join("")}</tr>`
        ).join("")
      }</tbody></table>`;

    const deptRows = Array.from(deptMap.entries()).map(([k, v]) => {
      const a = aggGroup(v);
      return [k, a.total, a.submitted, pct(a.submitted, a.total), a.passC, a.failC, pct(a.passC, a.submitted), a.credit.toFixed(1)];
    }).sort((a, b) => (b[1] as number) - (a[1] as number));
    const majorRows = Array.from(majorMap.entries()).map(([k, v]) => {
      const a = aggGroup(v);
      return [k, a.total, a.submitted, pct(a.submitted, a.total), a.passC, a.failC, pct(a.passC, a.submitted), a.credit.toFixed(1), a.avg.toFixed(2)];
    }).sort((a, b) => (b[1] as number) - (a[1] as number));

    const classRows = classEntries.map((e) => [
      e.name, e.major, e.a.total, e.a.submitted, e.a.notSub, pct(e.a.submitted, e.a.total),
      e.a.approved, e.a.rejected, e.a.pending, e.a.credit.toFixed(1), e.a.avg.toFixed(2),
      e.a.passC, e.a.failC,
      `<span class="pill ${e.a.passRate >= 0.8 ? "ok" : e.a.passRate < 0.6 ? "bad" : "warn"}">${pct(e.a.passC, e.a.submitted)}</span>`,
    ]);

    const failBlocks = failClasses.length === 0
      ? `<div class="empty">✓ 当前批次无不合格学生</div>`
      : failClasses.map((e) => `
        <div class="fail-block">
          <div class="head">
            <strong>${esc(e.name)} <span style="color:#64748b;font-weight:400;">（${esc(e.major)}）</span></strong>
            <span class="stat">不合格 <b style="color:#ef4444">${e.fails.length}</b> / 已提交 ${e.a.submitted} 人 · 合格率 ${pct(e.a.passC, e.a.submitted)} · 未提交 ${e.a.notSub} 人</span>
          </div>
          ${tbl(["学号", "姓名", "已提交", "通过", "驳回", "待审", "当前学分", `距合格(${PASS_THRESHOLD})`],
            e.fails.map((s) => [s.student_no, s.full_name, s.submitted, s.approved, s.rejected, s.pending, s.total_credit.toFixed(1),
              `<b style="color:#ef4444">${s.gap.toFixed(1)}</b>`]))}
        </div>`).join("");

    const missBlocks = missClasses.length === 0
      ? `<div class="empty">✓ 学院全部学生均已提交</div>`
      : missClasses.map(([cls, list]) => `
        <div class="miss-block">
          <div class="head">${esc(cls)} <span style="color:#64748b;font-weight:400">未提交 ${list.length} 人</span></div>
          ${tbl(["学号", "姓名", "专业", "院系"], list.map((s) => [s.student_no, s.full_name, s.major, s.department]))}
        </div>`).join("");

    const detailRows = appList.map((a) => {
      const p = profileMap.get(a.student_id) ?? {};
      const r = a.ai_matched_rule_id ? ruleMap.get(a.ai_matched_rule_id) : null;
      const desc = (a.description ?? "").replace(/\s+/g, " ").slice(0, 60);
      const st = STATUS_LABEL[a.status] ?? a.status;
      const tone = st.includes("通过") ? "ok" : st.includes("驳回") ? "bad" : "warn";
      return [
        fmtDT(a.submitted_at).slice(5, 16),
        p.student_no ?? "", p.full_name ?? "", p.class_name ?? "",
        `<span class="pill ${tone}">${esc(st)}</span>`,
        r?.name ?? "—",
        a.ai_suggested_credit ?? "",
        a.final_credit ?? "",
        desc,
      ];
    });

    const html = `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(collegeName)} · ${esc(win.name)} · 批次提交报告</title>
<style>${css}</style>
</head><body>
<div class="toolbar">
  <button onclick="window.print()">🖨️ 打印 / 保存为 PDF</button>
  <span class="meta">提示：在打印对话框中可选"另存为 PDF"</span>
</div>
<div class="page">
  <div class="cover">
    <h1>批次提交报告</h1>
    <div class="sub">${esc(collegeName)} · ${esc(win.name)}</div>
    <div class="sub">批次时间：${esc(fmtDT(win.starts_at))} — ${esc(fmtDT(win.ends_at))}</div>
    <div class="sub">生成：${esc(fmtDT(new Date().toISOString()))}${actorEmail ? ` · ${esc(actorEmail)}` : ""}</div>
  </div>

  <h2>关键指标</h2>
  <div class="kpi-grid">
    ${kpiCard("学院学生总数", totalStudents)}
    ${kpiCard("已提交学生", submittedStudents)}
    ${kpiCard("未提交学生", notSubmitted.length, notSubmitted.length > 0 ? "warn" : undefined)}
    ${kpiCard("提交率", pct(submittedStudents, totalStudents))}
    ${kpiCard("申请总数", totalApps)}
    ${kpiCard("通过申请", appApproved, "ok")}
    ${kpiCard("驳回申请", appRejected, appRejected > 0 ? "bad" : undefined)}
    ${kpiCard("待审申请", appPending, appPending > 0 ? "warn" : undefined)}
    ${kpiCard("累计通过学分", totalCredit.toFixed(1))}
    ${kpiCard(`合格人数 (≥${PASS_THRESHOLD})`, passMain, "ok")}
    ${kpiCard("不合格人数", failMain, failMain > 0 ? "bad" : undefined)}
    ${kpiCard("合格率", pct(passMain, submittedStudents))}
  </div>

  <h2>申请状态分布</h2>
  ${statusBars}

  <h2>学分合格情况 <span class="hint">（按已提交学生）</span></h2>
  ${tbl(["合格阈值", "合格人数", "不合格人数", "合格率"], [
    ["≥ 2 学分", passN(2), failN(2), pct(passN(2), submittedStudents)],
    [`≥ ${PASS_THRESHOLD} 学分（主）`, passMain, failMain, pct(passMain, submittedStudents)],
    ["≥ 6 学分", passN(6), failN(6), pct(passN(6), submittedStudents)],
  ])}

  <h2>最近 14 天提交趋势</h2>
  ${trendHtml}

  <h2>按院系分布</h2>
  ${tbl(["院系", "学生", "已提交", "提交率", "合格", "不合格", "合格率", "累计学分"], deptRows)}

  <h2>按专业分布</h2>
  ${tbl(["专业", "学生", "已提交", "提交率", "合格", "不合格", "合格率", "累计学分", "人均"], majorRows)}

  <h2>按班级分布</h2>
  ${tbl(["班级","专业","人数","已提交","未提交","提交率","通过","驳回","待审","累计学分","人均","合格","不合格","合格率"], classRows)}

  <h2>不合格学生名单 <span class="hint">（按班级，重点跟进 · 阈值 ${PASS_THRESHOLD} 学分）</span></h2>
  ${failBlocks}

  <h2>未提交学生名单 <span class="hint">（按班级）</span></h2>
  ${missBlocks}

  <h2>申请明细 <span class="hint">（共 ${totalApps} 条）</span></h2>
  ${tbl(["时间","学号","姓名","班级","状态","匹配规则","AI建议","最终","描述"], detailRows)}

  <div style="margin-top:32px;color:#94a3b8;font-size:11px;text-align:center;">
    ${esc(collegeName)} · ${esc(win.name)} · 由系统自动生成于 ${esc(fmtDT(new Date().toISOString()))}
  </div>
</div>
</body></html>`;

    const filePath = `reports/${collegeId}/${window_id}-${Date.now()}.html`;
    const { error: upErr } = await admin.storage.from("application-files").upload(
      filePath, new TextEncoder().encode(html),
      { contentType: "text/html; charset=utf-8", upsert: true },
    );
    if (upErr) throw upErr;

    const summary = {
      window: { id: win.id, name: win.name, starts_at: win.starts_at, ends_at: win.ends_at },
      kpi: {
        total_students: totalStudents, submitted_students: submittedStudents,
        not_submitted: notSubmitted.length, total_applications: totalApps,
        approved: appApproved, rejected: appRejected, pending: appPending,
        total_credit: totalCredit, pass: passMain, fail: failMain, pass_threshold: PASS_THRESHOLD,
      },
      class_distribution: classEntries.map((e) => ({ class: e.name, major: e.major, ...e.a })),
      fail_classes: failClasses.map((e) => ({
        class: e.name, major: e.major, fail_count: e.fails.length,
        fails: e.fails.map((s) => ({ student_no: s.student_no, full_name: s.full_name, total_credit: s.total_credit, gap: s.gap })),
      })),
      status_distribution: statusDist,
      daily_trend: trend,
    };

    await admin.from("submission_window_reports").insert({
      window_id, college_id: collegeId, summary, file_path: filePath, generated_by: actorId,
    });
    await admin.from("submission_windows").update({
      report_generated_at: new Date().toISOString(), report_path: filePath,
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
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}