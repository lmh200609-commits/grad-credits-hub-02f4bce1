import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Msg = { role: "user" | "assistant" | "system"; content: string };

const SYSTEM_PROMPT = `你是「学分认定规则问答助手」，仅服务于学生关于学分认定规则的咨询。

【严格行为约束】
1. 你只能依据下方「检索到的规则」和「相关案例」作答，禁止编造任何规则、学分数、级别、条件。
2. 若提供的规则/案例不足以回答问题，必须明确说"无法判断"，并引导用户补充关键信息（如证书全称、级别、获奖等级、参与角色、是否第一作者/参赛者等）。
3. 你不是审批员，不做最终学分判定。回答中可以说"建议参考 X 学分"，但禁止使用"批准/通过/已认定"等终审措辞。
4. 拒绝闲聊和与学分认定无关的问题，统一回复："我只能回答学分认定相关问题。"

【输出格式（必须严格遵守，三段式）】
结论：xxx
依据：xxx（引用规则名称和具体条款解释）
补充：xxx（相关案例或注意事项；没有可写"无"）

不要使用 Markdown 标题，不要加额外章节。`;

function tokenize(s: string): string[] {
  return (s || "").toLowerCase().match(/[\u4e00-\u9fa5]|[a-z0-9]+/g) || [];
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
  return score;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY 未配置");

    const { messages } = (await req.json()) as { messages: Msg[] };
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

    // RAG: load all active rules, score in memory
    const { data: allRules } = await supabase
      .from("rules")
      .select("id,name,keywords,description,identity,level,achievement,project,category,credit")
      .eq("active", true);

    const scored = (allRules || [])
      .map((r) => ({ r, s: scoreRule(query, r) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.r);

    if (scored.length === 0) {
      return new Response(JSON.stringify({
        answer: "结论：未找到相关认定规则，无法回答。\n依据：知识库中暂无与您问题匹配的规则。\n补充：请补充关键信息后再试，例如：成果/证书全称、级别（校级/省级/国家级/国际级）、获奖等级、您的参与角色（第一作者/团队成员等）。",
        matched_rules: [],
        matched_cases_count: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ruleIds = scored.map((r) => r.id);
    const { data: cases } = await supabase
      .from("cases")
      .select("title,summary,awarded_credit,notes,rule_id")
      .in("rule_id", ruleIds)
      .limit(5);

    const rulesText = scored.map((r, i) =>
      `【规则${i + 1}】${r.name}\n  类别：${r.category || "-"} | 身份：${r.identity || "-"} | 级别：${r.level || "-"} | 获奖等级：${r.achievement || "-"} | 项目：${r.project || "-"}\n  学分：${r.credit}\n  关键词：${(r.keywords || []).join("、") || "-"}\n  说明：${r.description || "-"}`
    ).join("\n\n");

    const casesText = (cases && cases.length > 0)
      ? cases.map((c, i) => `【案例${i + 1}】${c.title}\n  认定学分：${c.awarded_credit ?? "-"}\n  摘要：${c.summary}\n  备注：${c.notes || "-"}`).join("\n\n")
      : "（无相关历史案例）";

    const ragContext = `===== 检索到的规则 =====\n${rulesText}\n\n===== 相关案例 =====\n${casesText}`;

    const fullMessages: Msg[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: ragContext },
      ...messages.slice(-20),
    ];

    const resp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: fullMessages,
        temperature: 0.2,
        stream: false,
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("DeepSeek error:", resp.status, t);
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
    const answer = data?.choices?.[0]?.message?.content?.trim() || "（无回答）";

    return new Response(JSON.stringify({
      answer,
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