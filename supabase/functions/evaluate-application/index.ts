// AI evaluator with vision: pulls application + active rules + recent cases,
// downloads attached image (if any) and asks Qwen3-VL-32B-Thinking to match a rule
// and decide credit + confidence, then writes review record and updates application.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HIGH_CONFIDENCE = 0.85;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

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

    // Try to fetch the attachment as image (Qwen3-VL accepts image_url with data: URLs)
    let imageDataUrl: string | null = null;
    let attachmentNote = "无附件";
    if (app.file_path) {
      if (IMAGE_EXT.test(app.file_path)) {
        const { data: blob, error: dlErr } = await admin.storage
          .from("application-files")
          .download(app.file_path);
        if (!dlErr && blob) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          // base64 encode
          let bin = "";
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
          const b64 = btoa(bin);
          const ext = app.file_path.split(".").pop()!.toLowerCase();
          const mime = ext === "jpg" ? "jpeg" : ext;
          imageDataUrl = `data:image/${mime};base64,${b64}`;
          attachmentNote = "已附图片，请同时审阅";
        } else {
          attachmentNote = "附件下载失败";
        }
      } else {
        attachmentNote = `附件为非图片文件 (${app.file_path.split(".").pop()})，未传入视觉模型`;
      }
    }

    const systemPrompt = `你是大学学分认证审核助手，可以同时阅读文字材料和证明图片。请基于"规则库"和"案例库"评估学生申请：
1. 若提供了图片，先 OCR / 描述图片关键信息（证书名称、级别、获奖人、机构、日期），并判断与申请描述是否一致；明显伪造、AI 生成、信息冲突应大幅降低 confidence。
2. 从规则库挑选最匹配的一条规则（matched_rule_id 必须严格来自规则库 id）。如果没有任何规则匹配，matched_rule_id 返回 null。
3. confidence ∈ [0,1]：完全契合 ≥ 0.85；部分契合 0.35~0.85；几乎不符 < 0.35。
4. credit：建议给的学分（参考规则中默认学分，可上下浮动 ±0.5）。
5. recommendation：approve / review / reject。
6. reasoning：用中文 2-4 句话说明判断依据，含图片观察结论。
不允许编造规则或学分。`;

    const userText = JSON.stringify({
      application: {
        description: app.description,
        selected_keywords: app.selected_keywords,
        attachment: attachmentNote,
      },
      rules,
      reference_cases: cases,
    });

    const userContent: unknown[] = [{ type: "text", text: userText }];
    if (imageDataUrl) {
      userContent.push({ type: "image_url", image_url: { url: imageDataUrl } });
    }

    const aiResp = await fetch(
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
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
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
      },
    );

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("Qwen gateway error:", aiResp.status, t);
      if (aiResp.status === 429) return json({ error: "AI 请求过于频繁，请稍后再试" }, 429);
      if (aiResp.status === 401 || aiResp.status === 403) {
        return json({ error: "DashScope 鉴权失败，请检查 DASHSCOPE_API_KEY" }, 500);
      }
      return json({ error: `AI 评估失败: ${t.slice(0, 200)}` }, 500);
    }

    const aiJson = await aiResp.json();
    const call = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      console.error("Qwen unexpected payload:", JSON.stringify(aiJson).slice(0, 500));
      return json({ error: "AI 返回格式错误" }, 500);
    }
    const result = JSON.parse(call.function.arguments);

    let nextStatus: string;
    if (result.recommendation === "approve" && result.confidence >= HIGH_CONFIDENCE) {
      nextStatus = "auto_approved";
    } else if (result.recommendation === "reject" && result.confidence >= HIGH_CONFIDENCE) {
      nextStatus = "rejected_by_ai";
    } else {
      nextStatus = "pending_review";
    }

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

    return json({
      success: true,
      status: nextStatus,
      vision_used: !!imageDataUrl,
      ...result,
      matched_rule_id: matchedRuleId,
    });
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
