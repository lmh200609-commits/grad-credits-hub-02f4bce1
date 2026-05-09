// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { jsPDF } from "npm:jspdf@2.5.2";
import autoTable from "npm:jspdf-autotable@3.8.4";

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

// 主题色
const C = {
  primary: [31, 78, 121] as [number, number, number],
  primarySoft: [225, 235, 245] as [number, number, number],
  ok: [16, 185, 129] as [number, number, number],
  bad: [239, 68, 68] as [number, number, number],
  warn: [245, 158, 11] as [number, number, number],
  text: [30, 41, 59] as [number, number, number],
  sub: [100, 116, 139] as [number, number, number],
  zebra: [245, 248, 251] as [number, number, number],
  border: [203, 213, 225] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

// 模块级字体缓存
let FONT_CACHE: { regular?: string; bold?: string; loaded?: boolean } = {};

const FONT_URLS_REGULAR = [
  "https://cdn.jsdelivr.net/gh/StellarCN/scp_zh@master/fonts/NotoSansSC-Regular.ttf",
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
];
const FONT_URLS_BOLD = [
  "https://cdn.jsdelivr.net/gh/StellarCN/scp_zh@master/fonts/NotoSansSC-Bold.ttf",
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf",
];

async function fetchFontBase64(urls: string[]): Promise<string | null> {
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      // base64 encode
      let s = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK) as any);
      }
      return btoa(s);
    } catch (e) {
      console.warn("font fetch failed", u, e);
    }
  }
  return null;
}

async function ensureFonts() {
  if (FONT_CACHE.loaded) return;
  const [reg, bold] = await Promise.all([
    fetchFontBase64(FONT_URLS_REGULAR),
    fetchFontBase64(FONT_URLS_BOLD),
  ]);
  FONT_CACHE = { regular: reg ?? undefined, bold: bold ?? reg ?? undefined, loaded: true };
  if (!reg) console.warn("[report] CJK font not loaded, Chinese characters may render as boxes");
}

function registerFonts(doc: any) {
  if (FONT_CACHE.regular) {
    doc.addFileToVFS("NotoSC-Regular.ttf", FONT_CACHE.regular);
    doc.addFont("NotoSC-Regular.ttf", "NotoSC", "normal");
  }
  if (FONT_CACHE.bold) {
    doc.addFileToVFS("NotoSC-Bold.ttf", FONT_CACHE.bold);
    doc.addFont("NotoSC-Bold.ttf", "NotoSC", "bold");
  }
  if (FONT_CACHE.regular) {
    doc.setFont("NotoSC", "normal");
  }
}

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
const fmtDT = (s?: string | null) =>
  s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "";

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
      actorId = u.user.id;
      actorEmail = u.user.email ?? null;
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", actorId);
      const ok = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "super_admin");
      if (!ok) return json({ error: "forbidden" }, 403);
    }

    // === 数据采集 ===
    const { data: win, error: winErr } = await admin
      .from("submission_windows").select("*").eq("id", window_id).single();
    if (winErr || !win) return json({ error: "window not found" }, 404);

    const collegeId = win.college_id;
    const startsAt = win.starts_at;
    const endsAt = win.ends_at;

    const { data: collegeRow } = await admin
      .from("colleges").select("name, short_name, system_title").eq("id", collegeId).maybeSingle();
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
      .select("id, student_id, status, description, selected_keywords, custom_keywords, ai_suggested_credit, ai_confidence, final_credit, ai_matched_rule_id, submitted_at, reviewed_at")
      .eq("college_id", collegeId)
      .gte("submitted_at", startsAt)
      .lte("submitted_at", endsAt)
      .order("submitted_at", { ascending: true });
    const appList = (apps ?? []) as any[];

    const ruleIds = Array.from(new Set(appList.map((a) => a.ai_matched_rule_id).filter(Boolean)));
    const { data: rules } = await admin.from("rules").select("id, name").in("id", ruleIds.length ? ruleIds : ["00000000-0000-0000-0000-000000000000"]);
    const ruleMap = new Map<string, any>((rules ?? []).map((r: any) => [r.id, r]));

    // === 学生级聚合 ===
    type StuAgg = {
      student_id: string;
      student_no: string;
      full_name: string;
      department: string;
      class_name: string;
      major: string;
      submitted: number;
      approved: number;
      rejected: number;
      pending: number;
      total_credit: number;
    };
    const byStu = new Map<string, StuAgg>();
    studentIds.forEach((sid) => {
      const p = profileMap.get(sid) ?? {};
      byStu.set(sid, {
        student_id: sid,
        student_no: p.student_no ?? "",
        full_name: p.full_name ?? "",
        department: p.department ?? "未填写",
        class_name: p.class_name ?? "未填写",
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
      } else if (a.status === "rejected" || a.status === "rejected_by_ai") {
        s.rejected += 1;
      } else {
        s.pending += 1;
      }
    });
    const stuList = Array.from(byStu.values());

    // KPI
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
    const passMain = passN(PASS_THRESHOLD);
    const failMain = failN(PASS_THRESHOLD);

    // 状态分布
    const statusDist: Record<string, number> = {};
    appList.forEach((a) => {
      const lbl = STATUS_LABEL[a.status] ?? a.status;
      statusDist[lbl] = (statusDist[lbl] ?? 0) + 1;
    });

    // 14 天趋势
    const dayMap: Record<string, number> = {};
    appList.forEach((a) => {
      const d = (a.submitted_at as string).slice(0, 10);
      dayMap[d] = (dayMap[d] ?? 0) + 1;
    });
    const trend: { date: string; count: number }[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(today); dt.setDate(today.getDate() - i);
      const key = dt.toISOString().slice(0, 10);
      trend.push({ date: key.slice(5), count: dayMap[key] ?? 0 });
    }

    // 院系 / 专业聚合
    const groupBy = <T,>(arr: StuAgg[], key: (s: StuAgg) => string) => {
      const m = new Map<string, StuAgg[]>();
      arr.forEach((s) => {
        const k = key(s) || "未填写";
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(s);
      });
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
      const failC = submitted - passC;
      return {
        total, submitted, notSub: total - submitted, approved, rejected, pending,
        credit, avg: total > 0 ? credit / total : 0, passC, failC,
        passRate: submitted > 0 ? passC / submitted : 0,
        subRate: total > 0 ? submitted / total : 0,
      };
    };
    const deptMap = groupBy(stuList, (s) => s.department);
    const majorMap = groupBy(stuList, (s) => s.major);
    const classMap = groupBy(stuList, (s) => s.class_name);

    // === PDF 生成 ===
    await ensureFonts();
    const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
    registerFonts(doc);
    const FONT = FONT_CACHE.regular ? "NotoSC" : "helvetica";
    const setFont = (style: "normal" | "bold" = "normal") => doc.setFont(FONT, style);

    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const M = 36; // 18mm
    let y = M;

    const setColor = (kind: "fill" | "draw" | "text", c: [number, number, number]) => {
      if (kind === "fill") doc.setFillColor(c[0], c[1], c[2]);
      if (kind === "draw") doc.setDrawColor(c[0], c[1], c[2]);
      if (kind === "text") doc.setTextColor(c[0], c[1], c[2]);
    };

    const ensure = (need: number) => {
      if (y + need > PH - M - 20) {
        doc.addPage();
        y = M;
      }
    };

    const sectionTitle = (text: string) => {
      ensure(40);
      setColor("fill", C.primary);
      doc.rect(M, y, 4, 18, "F");
      setFont("bold"); doc.setFontSize(14); setColor("text", C.text);
      doc.text(text, M + 12, y + 14);
      y += 28;
      setFont("normal");
    };

    const subText = (text: string, size = 10, color = C.sub) => {
      setFont("normal"); doc.setFontSize(size); setColor("text", color);
      doc.text(text, M, y);
      y += size + 4;
    };

    // ===== 封面 =====
    setColor("fill", C.primary);
    doc.rect(0, 0, PW, 90, "F");
    setColor("text", C.white); setFont("bold"); doc.setFontSize(22);
    doc.text("批次提交报告", M, 50);
    setFont("normal"); doc.setFontSize(12);
    doc.text(`${collegeName} · ${win.name}`, M, 72);
    y = 110;

    setColor("text", C.sub); doc.setFontSize(10);
    doc.text(`批次时间：${fmtDT(startsAt)}  —  ${fmtDT(endsAt)}`, M, y); y += 14;
    doc.text(`生成时间：${fmtDT(new Date().toISOString())}${actorEmail ? "    生成人：" + actorEmail : ""}`, M, y);
    y += 24;

    // KPI 卡片
    const kpis: { label: string; value: string; tone?: "ok" | "bad" | "warn" }[] = [
      { label: "学院学生总数", value: String(totalStudents) },
      { label: "已提交学生", value: String(submittedStudents) },
      { label: "未提交学生", value: String(notSubmitted.length), tone: notSubmitted.length > 0 ? "warn" : undefined },
      { label: "提交率", value: pct(submittedStudents, totalStudents) },
      { label: "申请总数", value: String(totalApps) },
      { label: "通过申请", value: String(appApproved), tone: "ok" },
      { label: "驳回申请", value: String(appRejected), tone: "bad" },
      { label: "待审申请", value: String(appPending), tone: "warn" },
      { label: "累计通过学分", value: totalCredit.toFixed(1) },
      { label: `合格人数 (≥${PASS_THRESHOLD})`, value: String(passMain), tone: "ok" },
      { label: "不合格人数", value: String(failMain), tone: failMain > 0 ? "bad" : undefined },
      { label: "合格率", value: pct(passMain, submittedStudents) },
    ];
    const cardW = (PW - M * 2 - 12) / 4;
    const cardH = 54;
    kpis.forEach((k, i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const x = M + col * (cardW + 4);
      const cy = y + row * (cardH + 6);
      setColor("fill", C.primarySoft); setColor("draw", C.primary);
      doc.setLineWidth(0.6);
      doc.roundedRect(x, cy, cardW, cardH, 4, 4, "FD");
      setColor("text", C.sub); setFont("normal"); doc.setFontSize(8.5);
      doc.text(k.label, x + 8, cy + 14);
      setFont("bold"); doc.setFontSize(16);
      const valColor = k.tone === "ok" ? C.ok : k.tone === "bad" ? C.bad : k.tone === "warn" ? C.warn : C.primary;
      setColor("text", valColor);
      doc.text(k.value, x + 8, cy + 36);
    });
    y += 3 * (cardH + 6) + 8;

    // ===== 状态分布 =====
    sectionTitle("申请状态分布");
    const statusRows = Object.entries(statusDist).map(([k, v]) => [k, v, pct(v, totalApps)]);
    if (statusRows.length === 0) statusRows.push(["—", 0, "—"]);
    autoTable(doc, {
      startY: y,
      head: [["状态", "数量", "占比"]],
      body: statusRows as any,
      theme: "grid",
      styles: { font: FONT, fontSize: 10, textColor: C.text, lineColor: C.border, cellPadding: 5 },
      headStyles: { font: FONT, fontStyle: "bold", fillColor: C.primary, textColor: C.white },
      alternateRowStyles: { fillColor: C.zebra },
      margin: { left: M, right: M },
      didDrawCell: (d: any) => {
        if (d.section === "body" && d.column.index === 0) {
          const txt = String(d.cell.raw ?? "");
          let dot: [number, number, number] | null = null;
          if (txt.includes("通过")) dot = C.ok;
          else if (txt.includes("驳回")) dot = C.bad;
          else if (txt.includes("待") || txt.includes("评估")) dot = C.warn;
          if (dot) {
            doc.setFillColor(dot[0], dot[1], dot[2]);
            doc.circle(d.cell.x + 4, d.cell.y + d.cell.height / 2, 2, "F");
          }
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 14;

    // ===== 学分合格情况 =====
    sectionTitle("学分合格情况（按已提交学生）");
    autoTable(doc, {
      startY: y,
      head: [["合格阈值", "合格人数", "不合格人数", "合格率"]],
      body: [
        [`≥ 2 学分`, passN(2), failN(2), pct(passN(2), submittedStudents)],
        [`≥ ${PASS_THRESHOLD} 学分（主）`, passMain, failMain, pct(passMain, submittedStudents)],
        [`≥ 6 学分`, passN(6), failN(6), pct(passN(6), submittedStudents)],
      ] as any,
      theme: "grid",
      styles: { font: FONT, fontSize: 10, textColor: C.text, lineColor: C.border, cellPadding: 5, halign: "center" },
      headStyles: { font: FONT, fontStyle: "bold", fillColor: C.primary, textColor: C.white, halign: "center" },
      alternateRowStyles: { fillColor: C.zebra },
      margin: { left: M, right: M },
      didParseCell: (d: any) => {
        if (d.section === "body" && d.row.index === 1) {
          d.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 14;

    // ===== 14 天趋势 =====
    sectionTitle("最近 14 天提交趋势");
    {
      ensure(120);
      const cw = PW - M * 2;
      const ch = 90;
      const ox = M, oy = y;
      setColor("draw", C.border); doc.setLineWidth(0.5);
      doc.rect(ox, oy, cw, ch);
      const max = Math.max(1, ...trend.map((t) => t.count));
      const stepX = cw / Math.max(1, trend.length - 1);
      // grid
      setColor("draw", [230, 234, 240]);
      for (let i = 1; i < 4; i++) {
        const gy = oy + (ch / 4) * i;
        doc.line(ox, gy, ox + cw, gy);
      }
      // line
      setColor("draw", C.primary); doc.setLineWidth(1.4);
      let prev: { x: number; y: number } | null = null;
      trend.forEach((t, i) => {
        const px = ox + stepX * i;
        const py = oy + ch - (t.count / max) * (ch - 6) - 3;
        if (prev) doc.line(prev.x, prev.y, px, py);
        prev = { x: px, y: py };
      });
      // dots + labels
      setColor("fill", C.primary);
      trend.forEach((t, i) => {
        const px = ox + stepX * i;
        const py = oy + ch - (t.count / max) * (ch - 6) - 3;
        doc.circle(px, py, 1.6, "F");
      });
      setFont("normal"); doc.setFontSize(7); setColor("text", C.sub);
      trend.forEach((t, i) => {
        if (i % 2 === 0) {
          const px = ox + stepX * i;
          doc.text(t.date, px - 8, oy + ch + 10);
        }
      });
      doc.setFontSize(8);
      doc.text(`峰值 ${max}`, ox + cw - 40, oy + 10);
      y += ch + 22;
    }

    // ===== 院系 / 专业 =====
    sectionTitle("按院系分布");
    const deptRows = Array.from(deptMap.entries())
      .map(([k, v]) => {
        const a = aggGroup(v);
        return [k, a.total, a.submitted, pct(a.submitted, a.total), a.passC, a.failC, pct(a.passC, a.submitted), a.credit.toFixed(1)];
      })
      .sort((a: any, b: any) => b[1] - a[1]);
    autoTable(doc, {
      startY: y,
      head: [["院系", "学生", "已提交", "提交率", "合格", "不合格", "合格率", "累计学分"]],
      body: (deptRows.length ? deptRows : [["—", 0, 0, "—", 0, 0, "—", "0.0"]]) as any,
      theme: "grid",
      styles: { font: FONT, fontSize: 9.5, textColor: C.text, lineColor: C.border, cellPadding: 4 },
      headStyles: { font: FONT, fontStyle: "bold", fillColor: C.primary, textColor: C.white },
      alternateRowStyles: { fillColor: C.zebra },
      margin: { left: M, right: M },
    });
    y = (doc as any).lastAutoTable.finalY + 14;

    sectionTitle("按专业分布");
    const majorRows = Array.from(majorMap.entries())
      .map(([k, v]) => {
        const a = aggGroup(v);
        return [k, a.total, a.submitted, pct(a.submitted, a.total), a.passC, a.failC, pct(a.passC, a.submitted), a.credit.toFixed(1), a.avg.toFixed(2)];
      })
      .sort((a: any, b: any) => b[1] - a[1]);
    autoTable(doc, {
      startY: y,
      head: [["专业", "学生", "已提交", "提交率", "合格", "不合格", "合格率", "累计学分", "人均学分"]],
      body: (majorRows.length ? majorRows : [["—", 0, 0, "—", 0, 0, "—", "0.0", "0.00"]]) as any,
      theme: "grid",
      styles: { font: FONT, fontSize: 9.5, textColor: C.text, lineColor: C.border, cellPadding: 4 },
      headStyles: { font: FONT, fontStyle: "bold", fillColor: C.primary, textColor: C.white },
      alternateRowStyles: { fillColor: C.zebra },
      margin: { left: M, right: M },
    });
    y = (doc as any).lastAutoTable.finalY + 14;

    // ===== 班级分布 =====
    sectionTitle("按班级分布");
    const classEntries = Array.from(classMap.entries()).map(([k, v]) => {
      const sample = v[0];
      return { name: k, major: sample?.major ?? "", a: aggGroup(v) };
    }).sort((a, b) => b.a.total - a.a.total);
    autoTable(doc, {
      startY: y,
      head: [["班级", "专业", "人数", "已提交", "未提交", "提交率", "通过", "驳回", "待审", "累计学分", "人均", "合格", "不合格", "合格率"]],
      body: (classEntries.length
        ? classEntries.map((e) => [
            e.name, e.major, e.a.total, e.a.submitted, e.a.notSub,
            pct(e.a.submitted, e.a.total),
            e.a.approved, e.a.rejected, e.a.pending,
            e.a.credit.toFixed(1), e.a.avg.toFixed(2),
            e.a.passC, e.a.failC, pct(e.a.passC, e.a.submitted),
          ])
        : [["—", "—", 0, 0, 0, "—", 0, 0, 0, "0.0", "0.00", 0, 0, "—"]]) as any,
      theme: "grid",
      styles: { font: FONT, fontSize: 8.5, textColor: C.text, lineColor: C.border, cellPadding: 3, overflow: "linebreak" },
      headStyles: { font: FONT, fontStyle: "bold", fillColor: C.primary, textColor: C.white, halign: "center" },
      alternateRowStyles: { fillColor: C.zebra },
      margin: { left: M, right: M },
      didParseCell: (d: any) => {
        if (d.section === "body" && d.column.index === 13) {
          const e = classEntries[d.row.index];
          if (e && e.a.submitted > 0) {
            if (e.a.passRate >= 0.8) d.cell.styles.textColor = C.ok;
            else if (e.a.passRate < 0.6) d.cell.styles.textColor = C.bad;
          }
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 16;

    // ===== 不合格学生（按班级） =====
    doc.addPage(); y = M;
    sectionTitle("不合格学生名单（按班级，重点跟进）");
    subText(`判定标准：本批次内累计通过学分 < ${PASS_THRESHOLD}（不含未提交学生）`);
    y += 4;

    const classesWithFails = classEntries
      .map((e) => {
        const fails = (classMap.get(e.name) ?? [])
          .filter((s) => s.submitted > 0 && s.total_credit < PASS_THRESHOLD)
          .map((s) => ({
            ...s,
            gap: PASS_THRESHOLD - s.total_credit,
          }))
          .sort((a, b) => b.gap - a.gap);
        return { ...e, fails };
      })
      .filter((e) => e.fails.length > 0);

    if (classesWithFails.length === 0) {
      setColor("text", C.ok); setFont("bold"); doc.setFontSize(11);
      doc.text("✓ 当前批次无不合格学生", M, y); y += 20;
    } else {
      classesWithFails.forEach((e) => {
        ensure(60);
        setColor("fill", [254, 242, 242]); setColor("draw", C.bad); doc.setLineWidth(0.5);
        doc.roundedRect(M, y, PW - M * 2, 22, 3, 3, "FD");
        setColor("text", C.bad); setFont("bold"); doc.setFontSize(10.5);
        doc.text(`${e.name}（${e.major}）`, M + 8, y + 14);
        setFont("normal"); setColor("text", C.text);
        const stat = `不合格 ${e.fails.length} / 已提交 ${e.a.submitted} 人 · 合格率 ${pct(e.a.passC, e.a.submitted)} · 未提交 ${e.a.notSub} 人`;
        doc.text(stat, M + 8 + doc.getTextWidth(`${e.name}（${e.major}）`) + 12, y + 14);
        y += 26;
        autoTable(doc, {
          startY: y,
          head: [["学号", "姓名", "已提交", "通过", "驳回", "待审", "当前学分", `距合格(${PASS_THRESHOLD})`]],
          body: e.fails.map((s) => [
            s.student_no, s.full_name, s.submitted, s.approved, s.rejected, s.pending,
            s.total_credit.toFixed(1), s.gap.toFixed(1),
          ]) as any,
          theme: "grid",
          styles: { font: FONT, fontSize: 9, textColor: C.text, lineColor: C.border, cellPadding: 3.5 },
          headStyles: { font: FONT, fontStyle: "bold", fillColor: C.primary, textColor: C.white },
          alternateRowStyles: { fillColor: C.zebra },
          margin: { left: M, right: M },
          didParseCell: (d: any) => {
            if (d.section === "body" && d.column.index === 7) {
              d.cell.styles.fontStyle = "bold";
              d.cell.styles.textColor = C.bad;
            }
          },
        });
        y = (doc as any).lastAutoTable.finalY + 12;
      });
    }

    // ===== 未提交名单（按班级） =====
    doc.addPage(); y = M;
    sectionTitle("未提交学生名单（按班级）");
    const classesWithMiss: Map<string, StuAgg[]> = new Map();
    notSubmitted.forEach((s) => {
      const k = s.class_name || "未填写";
      if (!classesWithMiss.has(k)) classesWithMiss.set(k, []);
      classesWithMiss.get(k)!.push(s);
    });
    if (classesWithMiss.size === 0) {
      setColor("text", C.ok); setFont("bold"); doc.setFontSize(11);
      doc.text("✓ 学院全部学生均已提交", M, y); y += 20;
    } else {
      Array.from(classesWithMiss.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .forEach(([cls, list]) => {
          ensure(50);
          setColor("text", C.text); setFont("bold"); doc.setFontSize(10.5);
          doc.text(`${cls}　未提交 ${list.length} 人`, M, y);
          y += 8;
          autoTable(doc, {
            startY: y,
            head: [["学号", "姓名", "专业", "院系"]],
            body: list.map((s) => [s.student_no, s.full_name, s.major, s.department]) as any,
            theme: "grid",
            styles: { font: FONT, fontSize: 9, textColor: C.text, lineColor: C.border, cellPadding: 3.5 },
            headStyles: { font: FONT, fontStyle: "bold", fillColor: C.primary, textColor: C.white },
            alternateRowStyles: { fillColor: C.zebra },
            margin: { left: M, right: M },
          });
          y = (doc as any).lastAutoTable.finalY + 10;
        });
    }

    // ===== 申请明细 =====
    doc.addPage(); y = M;
    sectionTitle("申请明细（附录）");
    const detailRows = appList.map((a) => {
      const p = profileMap.get(a.student_id) ?? {};
      const r = a.ai_matched_rule_id ? ruleMap.get(a.ai_matched_rule_id) : null;
      const desc = (a.description ?? "").replace(/\s+/g, " ").slice(0, 50);
      return [
        fmtDT(a.submitted_at).slice(5, 16),
        p.student_no ?? "",
        p.full_name ?? "",
        p.class_name ?? "",
        STATUS_LABEL[a.status] ?? a.status,
        r?.name ?? "—",
        a.ai_suggested_credit ?? "",
        a.final_credit ?? "",
        desc,
      ];
    });
    autoTable(doc, {
      startY: y,
      head: [["时间", "学号", "姓名", "班级", "状态", "匹配规则", "AI建议", "最终", "描述"]],
      body: (detailRows.length ? detailRows : [["—", "—", "—", "—", "—", "—", "—", "—", "—"]]) as any,
      theme: "grid",
      styles: { font: FONT, fontSize: 8, textColor: C.text, lineColor: C.border, cellPadding: 3, overflow: "linebreak" },
      headStyles: { font: FONT, fontStyle: "bold", fillColor: C.primary, textColor: C.white },
      alternateRowStyles: { fillColor: C.zebra },
      columnStyles: {
        0: { cellWidth: 60 },
        5: { cellWidth: 80 },
        8: { cellWidth: 130 },
      },
      margin: { left: M, right: M },
      didParseCell: (d: any) => {
        if (d.section === "body" && d.column.index === 4) {
          const t = String(d.cell.raw ?? "");
          if (t.includes("通过")) { d.cell.styles.textColor = C.ok; d.cell.styles.fontStyle = "bold"; }
          else if (t.includes("驳回")) { d.cell.styles.textColor = C.bad; d.cell.styles.fontStyle = "bold"; }
          else { d.cell.styles.textColor = C.warn; }
        }
      },
    });

    // ===== 页脚（每页） =====
    const pageCount = (doc.internal as any).getNumberOfPages();
    const footerLeft = `${collegeName} · ${win.name}`;
    const footerRight = fmtDT(new Date().toISOString());
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      setColor("draw", C.border); doc.setLineWidth(0.4);
      doc.line(M, PH - M, PW - M, PH - M);
      setFont("normal"); doc.setFontSize(8); setColor("text", C.sub);
      doc.text(footerLeft, M, PH - M + 12);
      const center = `第 ${i} / ${pageCount} 页`;
      doc.text(center, PW / 2 - doc.getTextWidth(center) / 2, PH - M + 12);
      doc.text(footerRight, PW - M - doc.getTextWidth(footerRight), PH - M + 12);
    }

    // === 输出 ===
    const ab = doc.output("arraybuffer");
    const pdfBuf = new Uint8Array(ab);
    const filePath = `reports/${collegeId}/${window_id}-${Date.now()}.pdf`;
    const { error: upErr } = await admin.storage.from("application-files").upload(filePath, pdfBuf, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) throw upErr;

    const summary = {
      window: { id: win.id, name: win.name, starts_at: startsAt, ends_at: endsAt },
      kpi: {
        total_students: totalStudents,
        submitted_students: submittedStudents,
        not_submitted: notSubmitted.length,
        total_applications: totalApps,
        approved: appApproved, rejected: appRejected, pending: appPending,
        total_credit: totalCredit,
        pass: passMain, fail: failMain, pass_threshold: PASS_THRESHOLD,
      },
      class_distribution: classEntries.map((e) => ({
        class: e.name, major: e.major, ...e.a,
      })),
      dept_distribution: Array.from(deptMap.entries()).map(([k, v]) => ({ name: k, ...aggGroup(v) })),
      status_distribution: statusDist,
      daily_trend: trend,
      fail_classes: classesWithFails.map((e) => ({
        class: e.name, major: e.major, fail_count: e.fails.length,
        fails: e.fails.map((s) => ({ student_no: s.student_no, full_name: s.full_name, total_credit: s.total_credit, gap: s.gap })),
      })),
    };

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