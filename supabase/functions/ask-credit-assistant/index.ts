import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { normalizeMarkdown, toSections, shouldPolish, callPolish } from "../_shared/format-answer.ts";
import { getAiConfig } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Msg = { role: "user" | "assistant" | "system"; content: string };

const SYSTEM_PROMPT = `你是「学分认定规则问答助手」，仅服务于学生关于学分认定规则的咨询。

【严格行为约束】
1. 你只能依据下方「检索到的规则」「相关案例」「证书类型字典」「我的学分汇总」作答，禁止编造任何规则、学分数、级别、条件、申请记录。案例库（cases）与规则库（rules）同为合法依据，案例库优先用于解释相似情形——若仅有案例命中，应基于案例给出参考结论，并明确告知"以下结论来自历史相似案例，最终学分以教师复核为准"。
2. 若提供的资料不足以回答问题，必须明确说"无法判断"或"数据库中暂无相关记录"，并引导用户补充关键信息（如证书全称、级别、获奖等级、参与角色等）。
3. 你不是审批员，不做最终学分判定。回答中可以说"建议参考 X 学分"，但禁止使用"批准/通过/已认定"等终审措辞。
4. 拒绝闲聊和与学分认定无关的问题，统一回复："我只能回答学分认定相关问题。"
5. 涉及"我的"申请/学分明细时，仅可基于下方「我的学分汇总」段落作答；该段落为空时回复"暂无您的申请记录"。绝不编造申请编号、AI 结论、教师评语、学分数。
6. 严禁泄露任何其他学生的信息。如果用户询问他人，明确拒绝。
7. 当用户问"我是谁/我叫什么/我学号是多少/我哪个学院/我哪个班/我什么专业"等关于自身身份的问题时，必须严格基于下方"当前登录学生"段落如实回答，绝不允许说不知道或编造；该段落为空时回复"未识别到登录身份，请先登录"。

【输出格式（必须严格遵守）】
使用 markdown，固定三段，每段以二级标题开头：
## 结论
一句话给出结论。
## 依据
引用规则名称与条款，要点用 - 列表；并列信息超过 5 行用表格。
## 补充
相关案例或注意事项；没有写"无"。

禁止：一级标题、emoji、分割线、代码块、寒暄开场（如"作为 AI 助手…"）。
严禁使用 **加粗**、__加粗__、*斜体* 等 markdown 强调符号；严禁使用 ⚠️📎👇✅❌🎉🤖 等装饰 emoji 和 1️⃣2️⃣3️⃣ 等带圈数字。需要强调时直接用「」或换行。`;

function tokenize(s: string): string[] {
  return (s || "").toLowerCase().match(/[\u4e00-\u9fa5]|[a-z0-9]+/g) || [];
}

// 是否在询问"我的"个人数据（学分汇总/申请历史）
function isPersonalQuery(q: string): boolean {
  const s = (q || "").toLowerCase();
  const personal = ["我的", "我累计", "我提交", "我之前", "我现在", "我已经", "我有多少", "我多少", "我的学分", "我的申请", "我的记录"];
  return personal.some((k) => s.includes(k));
}

// 识别"我是谁/我叫什么/我学号/我哪个学院/我哪个班"等身份类问题
function isIdentityQuery(q: string): boolean {
  const s = (q || "");
  return /我是谁|我叫(什么|啥)|我的?名字|我学号|我的?学号|我哪个?学院|我哪个?系|我哪个?班|我什么专业|我的?专业|我是哪/.test(s);
}

// 识别"统计/盘点/总览"类问题：用户问规则/案例/佐证的数量、种类、有哪些类别等
function isStatsQuery(q: string): boolean {
  const s = (q || "").toLowerCase();
  const intent = ["多少", "几种", "几类", "几条", "数量", "总数", "总共", "一共", "盘点", "覆盖", "有哪些", "包含哪些", "种类", "分布", "统计", "目录", "清单", "列表"];
  const subject = ["规则", "条款", "佐证", "证明", "材料", "案例", "关键词", "类别", "类目", "项目", "认定"];
  return intent.some((k) => s.includes(k)) && subject.some((k) => s.includes(k));
}

// 识别问候/寒暄（你好、在吗、hi 等），用于给出友好引导而不是冷冰冰的"无法回答"
function isGreeting(q: string): boolean {
  const s = (q || "").trim().toLowerCase();
  if (!s) return false;
  if (s.length > 12) return false;
  const patterns = [
    /^(你好|您好|哈喽|哈啰|嗨|hi|hello|hey|in)[!！。.~\s]*$/i,
    /^(在吗|在么|在不在|有人吗|请问|早上好|中午好|下午好|晚上好|晚安)[!！。.~\s]*$/,
    /^(谢谢|感谢|thx|thanks|多谢|辛苦了|好的|ok|okay)[!！。.~\s]*$/i,
    /^(测试|test|ping)[!！。.~\s]*$/i,
  ];
  return patterns.some((p) => p.test(s));
}

// 询问助手能力 / "你能做什么"
function isCapabilityQuery(q: string): boolean {
  const s = (q || "").toLowerCase();
  return /(你能|你可以|你会|帮我做什么|能做什么|有什么功能|怎么用|如何使用|使用说明|帮助)/.test(s);
}

function formatStats(rules: any[], casesCount: number, keywordsCount: number): string {
  const total = rules.length;
  const byCategory = new Map<string, number>();
  const byLevel = new Map<string, number>();
  const byIdentity = new Map<string, number>();
  for (const r of rules) {
    const c = (r.category || "未分类").trim() || "未分类";
    const l = (r.level || "未指定").trim() || "未指定";
    const id = (r.identity || "未指定").trim() || "未指定";
    byCategory.set(c, (byCategory.get(c) || 0) + 1);
    byLevel.set(l, (byLevel.get(l) || 0) + 1);
    byIdentity.set(id, (byIdentity.get(id) || 0) + 1);
  }
  const fmt = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}（${v}）`).join("、") || "无";

  return `结论：当前知识库共有 ${total} 条有效学分认定规则，覆盖 ${byCategory.size} 个类别；案例库 ${casesCount} 条，关键词库 ${keywordsCount} 个。
依据：
- 按类别分布：${fmt(byCategory)}
- 按级别分布：${fmt(byLevel)}
- 按适用身份分布：${fmt(byIdentity)}
补充：以上为系统实时统计结果。如需了解某一类别/级别下的具体规则，请告知关键词（例如"竞赛 国家级"），我将检索对应规则为您解释。`;
}

function scoreRule(query: string, rule: any): number {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return 0;
  const fields = [
    rule.name,
    (rule.keywords || []).join(" "),
    rule.description,
    rule.identity,
    rule.level,
    rule.achievement,
    rule.project,
    rule.category,
  ].filter(Boolean).join(" ");
  const rTokens = tokenize(fields);
  let score = 0;
  for (const t of rTokens) if (qTokens.has(t)) score++;
  // boost keyword exact matches
  for (const kw of rule.keywords || []) {
    if (query.includes(kw)) score += 3;
  }
  // boost: 整词包含（用户 query 中 2~6 字中文连续片段）
  const phrases = extractCnPhrases(query);
  for (const p of phrases) {
    if (fields.includes(p)) score += 5;
  }
  return score;
}

function extractCnPhrases(q: string): string[] {
  const out = new Set<string>();
  const matches = (q || "").match(/[\u4e00-\u9fa5]{2,6}/g) || [];
  for (const m of matches) out.add(m);
  // 英文/数字整词
  const en = (q || "").match(/[A-Za-z0-9]{2,}/g) || [];
  for (const m of en) out.add(m);
  return Array.from(out);
}

function scoreCase(query: string, c: any): number {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return 0;
  const fields = [c.title, c.summary, c.notes].filter(Boolean).join(" ");
  const rTokens = tokenize(fields);
  let score = 0;
  for (const t of rTokens) if (qTokens.has(t)) score++;
  const phrases = extractCnPhrases(query);
  for (const p of phrases) {
    if (fields.includes(p)) score += 5;
  }
  return score;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as { messages: Msg[] };
    const messages = body.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages 不能为空" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const query = lastUser?.content?.trim() || "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // —— 识别学生身份（用 JWT），仅用于"我的"类问题 ——
    let myUserId: string | null = null;
    let myProfile: any = null;
    let mySummary = "";
    let identityBlock = "";
    const authHeader = req.headers.get("Authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const userClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: claims } = await userClient.auth.getClaims(token);
        myUserId = claims?.claims?.sub ?? null;
      } catch (_) { myUserId = null; }
    }

    // 无条件加载当前登录学生 profile（用于身份类问题）
    if (myUserId) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("user_id, full_name, student_no, department, class_name, major, college_id, email, phone")
        .eq("user_id", myUserId)
        .maybeSingle();
      myProfile = prof || null;
      let collegeName = "-";
      if ((prof as any)?.college_id) {
        const { data: col } = await supabase.from("colleges").select("name,short_name").eq("id", (prof as any).college_id).maybeSingle();
        if (col) collegeName = (col as any).short_name || (col as any).name || "-";
      }
      identityBlock = `===== 当前登录学生 =====\n姓名：${(prof as any)?.full_name ?? "-"}\n学号：${(prof as any)?.student_no ?? "-"}\n所属学院：${collegeName}\n部门：${(prof as any)?.department ?? "-"}\n班级：${(prof as any)?.class_name ?? "-"}\n专业：${(prof as any)?.major ?? "-"}\n邮箱：${(prof as any)?.email ?? "-"}`;
    }

    if (myUserId && isPersonalQuery(query)) {
      const { data: rows } = await supabase
        .from("submission_summary")
        .select("application_id, status, description, submitted_at, ai_confidence, ai_suggested_credit, ai_reasoning, final_credit, reviewer_name, final_review_note, reviewed_at")
        .eq("student_id", myUserId)
        .order("submitted_at", { ascending: false })
        .limit(20);

      // 学生问"我的"但确实没有任何申请记录 → 直接返回统一文案，不再走 RAG/早返回
      if (!rows || rows.length === 0) {
        const ans = normalizeMarkdown("## 结论\n暂无您的申请记录。\n\n## 依据\n数据库中未查询到您账号下的任何申请。\n\n## 补充\n如已提交，请到「我的申请」核对状态。");
        return new Response(JSON.stringify({
          answer: ans, sections: toSections(ans), meta: { polished: false },
          matched_rules: [], matched_cases_count: 0,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let totalCredit = 0;
      (rows || []).forEach((r: any) => {
        if (["approved", "auto_approved"].includes(r.status)) {
          totalCredit += Number(r.final_credit ?? r.ai_suggested_credit ?? 0);
        }
      });
      const lines = (rows || []).map((r: any, i: number) =>
        `【申请${i + 1}】${(r.description || "").slice(0, 40)}\n  状态：${r.status} | 提交时间：${(r.submitted_at || "").slice(0, 10)}\n  AI 初审：建议${r.ai_suggested_credit ?? "-"}学分（置信度 ${r.ai_confidence ?? "-"}）｜理由：${(r.ai_reasoning || "-").slice(0, 80)}\n  教师复核：${r.reviewer_name || "-"} 给出${r.final_credit ?? "-"}学分｜备注：${(r.final_review_note || "-").slice(0, 80)}`
      ).join("\n\n");
      mySummary = `===== 我的学分汇总 =====\n姓名：${myProfile?.full_name ?? "-"} | 学号：${myProfile?.student_no ?? "-"} | 累计已认定学分：${totalCredit}\n申请总数：${rows?.length ?? 0}\n${lines || "（暂无申请记录）"}`;
    }

    // 未登录但问"我的"：也统一返回（无法区分身份，按"无记录"处理）
    if (!myUserId && isPersonalQuery(query)) {
      const ans = normalizeMarkdown("## 结论\n暂无您的申请记录。\n\n## 依据\n未识别到登录身份。\n\n## 补充\n请先登录后再查询。");
      return new Response(JSON.stringify({
        answer: ans, sections: toSections(ans), meta: { polished: false },
        matched_rules: [], matched_cases_count: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // RAG: load all active rules, score in memory
    const { data: allRules } = await supabase
      .from("rules")
      .select("id,name,keywords,description,identity,level,achievement,project,category,credit")
      .eq("active", true);

    // 统计/盘点类问题：直接基于数据库给出实时数量分布
    if (isStatsQuery(query)) {
      const [{ count: casesCount }, { count: keywordsCount }] = await Promise.all([
        supabase.from("cases").select("id", { count: "exact", head: true }),
        supabase.from("keywords").select("id", { count: "exact", head: true }).eq("active", true),
      ]);
      const answer = formatStats(allRules || [], casesCount || 0, keywordsCount || 0);
      const cleaned = normalizeMarkdown(answer);
      return new Response(JSON.stringify({
        answer: cleaned,
        sections: toSections(cleaned),
        meta: { polished: false },
        matched_rules: [],
        matched_cases_count: casesCount || 0,
        stats: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const scored = (allRules || [])
      .map((r) => ({ r, s: scoreRule(query, r) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.r);

    // 案例库直接打分检索（独立于 rules）
    const { data: allCases } = await supabase
      .from("cases")
      .select("id,title,summary,awarded_credit,notes,rule_id")
      .order("created_at", { ascending: false })
      .limit(500);

    const scoredCases = (allCases || [])
      .map((c) => ({ c, s: scoreCase(query, c) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
      .map((x) => x.c);

    if (scored.length === 0 && scoredCases.length === 0 && !mySummary) {
      // 身份类问题：基于 identityBlock 直接回答，不再返回"未找到规则"
      if (identityBlock && isIdentityQuery(query)) {
        const p: any = myProfile || {};
        const ans = normalizeMarkdown(`## 结论\n您是 ${p.full_name ?? "-"}（学号 ${p.student_no ?? "-"}）。\n\n## 依据\n- 姓名：${p.full_name ?? "-"}\n- 学号：${p.student_no ?? "-"}\n- 班级：${p.class_name ?? "-"}\n- 专业：${p.major ?? "-"}\n- 部门：${p.department ?? "-"}\n\n## 补充\n如需查询您的申请记录或累计学分，请输入"我的申请"或"我的学分"。`);
        return new Response(JSON.stringify({
          answer: ans, sections: toSections(ans), meta: { polished: false },
          matched_rules: [], matched_cases_count: 0,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const ans = normalizeMarkdown("## 结论\n未找到相关认定规则或案例，无法回答。\n\n## 依据\n知识库与案例库中暂无与您问题匹配的内容。\n\n## 补充\n请补充关键信息后再试：\n- 成果/证书全称\n- 级别（校级/省级/国家级/国际级）\n- 获奖等级\n- 您的参与角色（第一作者/团队成员等）");
      return new Response(JSON.stringify({
        answer: ans, sections: toSections(ans), meta: { polished: false },
        matched_rules: [], matched_cases_count: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 合并：通过 rules 关联回带的案例 + 独立打分命中的案例（去重）
    const ruleIds = scored.map((r) => r.id);
    const { data: linkedCases } = ruleIds.length
      ? await supabase
          .from("cases")
          .select("id,title,summary,awarded_credit,notes,rule_id")
          .in("rule_id", ruleIds)
          .limit(5)
      : { data: [] as any[] };
    const seen = new Set<string>();
    const cases = [...scoredCases, ...((linkedCases as any[]) || [])].filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id); return true;
    }).slice(0, 8);

    const rulesText = scored.length > 0
      ? scored.map((r, i) =>
          `【规则${i + 1}】${r.name}\n  类别：${r.category || "-"} | 身份：${r.identity || "-"} | 级别：${r.level || "-"} | 获奖等级：${r.achievement || "-"} | 项目：${r.project || "-"}\n  学分：${r.credit}\n  关键词：${(r.keywords || []).join("、") || "-"}\n  说明：${r.description || "-"}`
        ).join("\n\n")
      : "（规则库未直接命中，请优先依据下方「相关案例」作答）";

    const casesText = (cases && cases.length > 0)
      ? cases.map((c, i) => `【案例${i + 1}】${c.title}\n  认定学分：${c.awarded_credit ?? "-"}\n  摘要：${c.summary}\n  备注：${c.notes || "-"}`).join("\n\n")
      : "（无相关历史案例）";

    const ragContext = `===== 检索到的规则 =====\n${rulesText}\n\n===== 相关案例 =====\n${casesText}`;

    const fullMessages: Msg[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: ragContext },
      ...(identityBlock ? [{ role: "system" as const, content: identityBlock }] : []),
      ...(mySummary ? [{ role: "system" as const, content: mySummary }] : []),
      ...messages.slice(-20),
    ];

    const aiCfg = await getAiConfig("ask-credit-assistant");
    const endpoint = `${aiCfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const apiKey = aiCfg.apiKey;
    const model = aiCfg.model;
    const provider = aiCfg.vendor;

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: fullMessages,
        temperature: 0.2,
        stream: false,
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error(`AI provider (${provider}) error:`, resp.status, t);
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 401 || resp.status === 402) {
        return new Response(JSON.stringify({ error: "AI 服务认证失败或额度不足，请联系管理员" }), {
          status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI 服务暂时不可用" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    let answer = data?.choices?.[0]?.message?.content?.trim() || "（无回答）";
    let polished = false;
    if (shouldPolish(answer)) {
      const r = await callPolish(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        answer,
      );
      if (r.polished) { answer = r.text; polished = true; }
    }
    const cleaned = normalizeMarkdown(answer);
    return new Response(JSON.stringify({
      answer: cleaned,
      sections: toSections(cleaned),
      meta: { polished },
      matched_rules: scored.map((r) => ({ id: r.id, name: r.name })),
      matched_cases_count: cases?.length || 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("ask-credit-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "未知错误" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});