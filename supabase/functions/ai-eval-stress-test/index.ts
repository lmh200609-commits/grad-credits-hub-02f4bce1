// AI 初审压测：用固定 10 个文本用例（无图片）跑同一个 Qwen 模型，
// 与 evaluate-application 共用判定逻辑，比对期望 vs 实际，便于回归。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Expected = "approve" | "review" | "reject";

type Case = {
  id: string;
  title: string;
  description: string;
  selected_keywords: string[];
  custom_keywords: string[];
  student_name: string;
  /** 模拟图片中识别到的内容（无图片时让模型基于此判断；真实场景由视觉识别） */
  simulated_image_content: string;
  expected: Expected;
  expected_consistency_ok?: boolean;
  expected_relevance_ok?: boolean;
  expected_authenticity_ok?: boolean;
  expected_name_match_ok?: boolean | null;
  notes: string;
};

const CASES: Case[] = [
  {
    id: "C1",
    title: "国一证书（本人）",
    description: "参加 2024 年 ACM 国际大学生程序设计竞赛，获得国家级一等奖。",
    selected_keywords: ["学科竞赛", "ACM 程序设计竞赛", "国家级一等奖"],
    custom_keywords: [],
    student_name: "张三",
    simulated_image_content: "证书：ACM 国际大学生程序设计竞赛 国家级一等奖，获奖人：张三，颁发单位：中国计算机学会。证书完整清晰，无明显篡改。",
    expected: "approve",
    expected_consistency_ok: true,
    expected_relevance_ok: true,
    expected_authenticity_ok: true,
    expected_name_match_ok: true,
    notes: "标准通过用例",
  },
  {
    id: "C2",
    title: "省三证书（本人）但选国一",
    description: "参加 ACM 程序设计竞赛获奖。",
    selected_keywords: ["学科竞赛", "ACM 程序设计竞赛", "国家级一等奖"],
    custom_keywords: [],
    student_name: "张三",
    simulated_image_content: "证书：XX 省大学生程序设计竞赛 省级三等奖，获奖人：张三。",
    expected: "reject",
    expected_consistency_ok: false,
    expected_relevance_ok: true,
    expected_authenticity_ok: true,
    expected_name_match_ok: true,
    notes: "级别不符：选国一实际省三",
  },
  {
    id: "C3",
    title: "英语六级当 ACM 提交",
    description: "通过英语六级考试。",
    selected_keywords: ["学科竞赛", "ACM 程序设计竞赛"],
    custom_keywords: [],
    student_name: "李四",
    simulated_image_content: "全国大学英语六级考试成绩单，姓名：李四，成绩 480 分。",
    expected: "reject",
    expected_consistency_ok: false,
    expected_relevance_ok: false,
    expected_authenticity_ok: true,
    expected_name_match_ok: true,
    notes: "类别完全错位",
  },
  {
    id: "C4",
    title: "风景照当材料",
    description: "参加学科竞赛获奖材料。",
    selected_keywords: ["学科竞赛", "国家级一等奖"],
    custom_keywords: [],
    student_name: "王五",
    simulated_image_content: "一张海边风景照片，没有任何证书、文字或姓名信息。",
    expected: "reject",
    expected_relevance_ok: false,
    notes: "完全无关图片",
  },
  {
    id: "C5",
    title: "明显 PS 证书",
    description: "国家级竞赛获奖证书。",
    selected_keywords: ["学科竞赛", "国家级一等奖"],
    custom_keywords: [],
    student_name: "赵六",
    simulated_image_content: "证书内容：XX 国家级竞赛一等奖，获奖人：赵六。但证书中字体不一致、奖项名称区域明显有 PS 痕迹、颜色断层、像素边缘模糊。",
    expected: "reject",
    expected_authenticity_ok: false,
    notes: "PS 篡改痕迹",
  },
  {
    id: "C6",
    title: "模糊证书",
    description: "参加学科竞赛获奖。",
    selected_keywords: ["学科竞赛", "省级一等奖"],
    custom_keywords: [],
    student_name: "孙七",
    simulated_image_content: "证书图片整体严重模糊，姓名、奖项级别均无法清晰辨认，仅能看出疑似为某竞赛证书。",
    expected: "review",
    notes: "模糊→人工复核",
  },
  {
    id: "C7",
    title: "他人证书冒用",
    description: "本人参加 ACM 竞赛获国家级一等奖。",
    selected_keywords: ["学科竞赛", "ACM 程序设计竞赛", "国家级一等奖"],
    custom_keywords: [],
    student_name: "周八",
    simulated_image_content: "证书：ACM 国际大学生程序设计竞赛 国家级一等奖，获奖人：陈九（与申请人姓名不一致）。证书本身真实、清晰。",
    expected: "reject",
    expected_name_match_ok: false,
    notes: "姓名完全不一致",
  },
  {
    id: "C8",
    title: "同名他人（已知盲点）",
    description: "本人获 ACM 国家级一等奖。",
    selected_keywords: ["学科竞赛", "ACM 程序设计竞赛", "国家级一等奖"],
    custom_keywords: [],
    student_name: "张伟",
    simulated_image_content: "证书：ACM 国际大学生程序设计竞赛 国家级一等奖，获奖人：张伟。证书完整清晰。",
    expected: "review",
    notes: "同名同姓，模型无法分辨；建议人工",
  },
  {
    id: "C9",
    title: "PDF 论文（无视觉）",
    description: "在核心期刊发表论文一篇，第一作者。",
    selected_keywords: ["科研成果", "论文", "第一作者"],
    custom_keywords: [],
    student_name: "吴十",
    simulated_image_content: "（无图片附件，仅有 PDF 论文文件，未做视觉核验）",
    expected: "review",
    notes: "非图片附件应走人工",
  },
  {
    id: "C10",
    title: "团队证书无本人姓名",
    description: "参加创新创业大赛获国家级二等奖，团队成员之一。",
    selected_keywords: ["创业实践", "国家级二等奖"],
    custom_keywords: [],
    student_name: "郑十一",
    simulated_image_content: "团队获奖证书：第 X 届创新创业大赛 国家级二等奖。仅列出团队成员前 3 人姓名（甲、乙、丙），未出现申请人姓名。",
    expected: "review",
    expected_name_match_ok: false,
    notes: "团队证书未列本人，建议人工核实排序",
  },
];

const SYSTEM_PROMPT = `你是大学学分材料核验助手。

【认定范围参考】本科生创新实践学分的认定范围包括：科研成果（论文）、知识产权、科研训练、学科竞赛、职业技能证书、创业实践、文体竞赛、第二课堂等。

本次为【纯文本压测模式】：没有真实图片，但 user 输入会提供 simulated_image_content 字段，请把它当作"图片中实际看到的内容"来核验。

你需要做四类核验 + 4 个 detected 字段：
1. consistency_ok：simulated_image_content 与 selected_keywords/custom_keywords 是否完全一致（级别/身份/奖项等级有差异即 false）
2. relevance_ok：图片是否与申请主题相关
3. authenticity_ok：是否无 PS / 拼接 / 伪造痕迹
4. name_match_ok：simulated_image_content 中姓名与 student.name 是否一致；无姓名信息则 null

detected_project / achievement / level / identity：基于 simulated_image_content 实际识别到的内容，无法识别填 null。

判定：
- 全部 ok 且 detected 与关键词一致 → approve, confidence≥0.85
- 任一不符或明显造假 → reject, confidence≥0.85
- 模糊/无法判断/无附件 → review, confidence 0.4~0.7

reasoning 中文，结构：「材料一致性：…；图片相关性：…；真实性：…；姓名匹配：…；图片实际识别：项目=…，成果=…，级别=…，身份=…；结论：…」`;

const TOOL = {
  type: "function" as const,
  function: {
    name: "submit_evaluation",
    description: "提交材料核验结果",
    parameters: {
      type: "object",
      properties: {
        consistency_ok: { type: "boolean" },
        relevance_ok: { type: "boolean" },
        authenticity_ok: { type: "boolean" },
        name_match_ok: { type: ["boolean", "null"] },
        detected_project: { type: ["string", "null"] },
        detected_achievement: { type: ["string", "null"] },
        detected_level: { type: ["string", "null"] },
        detected_identity: { type: ["string", "null"] },
        confidence: { type: "number" },
        recommendation: { type: "string", enum: ["approve", "review", "reject"] },
        reasoning: { type: "string" },
      },
      required: [
        "consistency_ok", "relevance_ok", "authenticity_ok", "name_match_ok",
        "detected_project", "detected_achievement", "detected_level", "detected_identity",
        "confidence", "recommendation", "reasoning",
      ],
      additionalProperties: false,
    },
  },
};

async function runOne(c: Case): Promise<{ ok: boolean; result?: any; error?: string; durationMs: number }> {
  const t0 = Date.now();
  try {
    const userPayload = {
      student: { name: c.student_name },
      application: {
        description: c.description,
        selected_keywords: c.selected_keywords,
        custom_keywords: c.custom_keywords,
        simulated_image_content: c.simulated_image_content,
      },
    };
    const resp = await fetch(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("DASHSCOPE_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen3-vl-32b-thinking",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(userPayload) },
          ],
          tools: [TOOL],
          tool_choice: { type: "function", function: { name: "submit_evaluation" } },
        }),
      },
    );
    if (!resp.ok) {
      const t = await resp.text();
      return { ok: false, error: `${resp.status}: ${t.slice(0, 160)}`, durationMs: Date.now() - t0 };
    }
    const j = await resp.json();
    const call = j.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return { ok: false, error: "no tool_call", durationMs: Date.now() - t0 };
    const result = JSON.parse(call.function.arguments);
    return { ok: true, result, durationMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: (e as Error).message, durationMs: Date.now() - t0 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const callerId = claimsData.claims.sub as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: callerId, _role: "admin" });
    if (!isAdmin) return json({ error: "Forbidden: admin only" }, 403);

    // 可选：只跑指定 case_id 子集
    let onlyIds: string[] | null = null;
    try {
      const body = await req.json();
      if (Array.isArray(body?.case_ids) && body.case_ids.length) onlyIds = body.case_ids;
    } catch (_) { /* no body */ }

    const cases = onlyIds ? CASES.filter((c) => onlyIds!.includes(c.id)) : CASES;

    const results = [] as any[];
    let pass = 0;
    const t0 = Date.now();
    for (const c of cases) {
      const r = await runOne(c);
      const passCase = r.ok && r.result?.recommendation === c.expected;
      if (passCase) pass++;
      results.push({
        id: c.id,
        title: c.title,
        notes: c.notes,
        expected: c.expected,
        expected_consistency_ok: c.expected_consistency_ok ?? null,
        expected_relevance_ok: c.expected_relevance_ok ?? null,
        expected_authenticity_ok: c.expected_authenticity_ok ?? null,
        expected_name_match_ok: c.expected_name_match_ok ?? null,
        ok: r.ok,
        pass: passCase,
        error: r.error ?? null,
        duration_ms: r.durationMs,
        actual: r.result ?? null,
      });
    }

    return json({
      total: cases.length,
      pass,
      fail: cases.length - pass,
      total_duration_ms: Date.now() - t0,
      results,
      cases_meta: cases.map((c) => ({
        id: c.id, title: c.title, description: c.description,
        selected_keywords: c.selected_keywords, student_name: c.student_name,
        simulated_image_content: c.simulated_image_content, notes: c.notes, expected: c.expected,
      })),
    });
  } catch (e) {
    console.error("stress-test error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}