// AI evaluator: pulls application + active rules + recent cases,
// asks Lovable AI to match a rule and decide credit + confidence,
// writes review record and updates application status.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HIGH_CONFIDENCE = 0.85;
const LOW_CONFIDENCE = 0.35;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimErr } = await userClient.auth.getClaims(token);
    if (claimErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);

    const { application_id } = await req.json();
    if (!application_id) return json({ error: "application_id required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: app, error: appErr } = await admin
      .from("applications")
      .select("*")
      .eq("id", application_id)
      .single();
    if (appErr || !app) return json({ error: "Application not found" }, 404);

    const { data: rules } = await admin
      .from("rules")
      .select("id, name, category, keywords, credit, description")
      .eq("active", true);

    const { data: cases } = await admin
      .from("cases")
      .select("title, summary, rule_id, awarded_credit, notes")
      .limit(20);

    const systemPrompt = `你是大学学分认证审核助手。根据"规则库"和"案例库"评估学生申请：
1. 从规则库挑选最匹配的一条规则（matched_rule_id 必须严格来自规则库 id）。如果没有任何规则匹配，matched_rule_id 返回 null。
2. 给出置信度 confidence ∈ [0,1]：完全契合 ≥ 0.85；部分契合 0.35~0.85；几乎不符 < 0.35。
3. credit：建议给的学分（参考规则中默认学分，可根据材料完整度上下浮动 ±0.5）。
4. recommendation：approve / review / reject。
5. reasoning：用中文 2-4 句话说明判断依据。
不允许编造规则或学分。`;

    const userPrompt = JSON.stringify({
      application: {
        description: app.description,
        selected_keywords: app.selected_keywords,
        has_attachment: !!app.file_path,
      },
      rules,
      reference_cases: cases,
    });

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_evaluation",
            description: "提交评估结果",
            parameters: {
              type: "object",
              properties: {
                matched_rule_id: { type: ["string", "null"] },
                credit: { type: "number" },
                confidence: { type: "number" },
                recommendation: { type: "string", enum: ["approve", "review", "reject"] },
                reasoning: { type: "string" },
              },
              required: ["matched_rule_id", "credit", "confidence", "recommendation", "reasoning"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_evaluation" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return json({ error: "AI 请求过于频繁，请稍后再试" }, 429);
      if (aiResp.status === 402) return json({ error: "AI 额度已耗尽，请联系管理员充值" }, 402);
      const t = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, t);
      return json({ error: "AI 评估失败" }, 500);
    }

    const aiJson = await aiResp.json();
    const call = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return json({ error: "AI 返回格式错误" }, 500);
    const result = JSON.parse(call.function.arguments);

    let nextStatus: string;
    if (result.recommendation === "approve" && result.confidence >= HIGH_CONFIDENCE) {
      nextStatus = "auto_approved";
    } else if (result.recommendation === "reject" && result.confidence >= HIGH_CONFIDENCE) {
      nextStatus = "rejected_by_ai";
    } else {
      nextStatus = "pending_review";
    }

    // Validate matched_rule_id actually exists
    let matchedRuleId: string | null = result.matched_rule_id;
    if (matchedRuleId && !rules?.some((r) => r.id === matchedRuleId)) matchedRuleId = null;

    await admin.from("application_reviews").insert({
      application_id,
      reviewer_id: null,
      action: "ai_evaluation",
      decision: nextStatus,
      credit: result.credit,
      confidence: result.confidence,
      matched_rule_id: matchedRuleId,
      note: result.reasoning,
    });

    await admin
      .from("applications")
      .update({
        status: nextStatus,
        ai_matched_rule_id: matchedRuleId,
        ai_suggested_credit: result.credit,
        ai_confidence: result.confidence,
        ai_reasoning: result.reasoning,
      })
      .eq("id", application_id);

    return json({ success: true, status: nextStatus, ...result, matched_rule_id: matchedRuleId });
  } catch (e) {
    console.error("evaluate error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
