// 系统材料核验：仅校验"材料 vs 关键词 vs 学生姓名"一致性，及是否存在
// 明显篡改 / AI 生成痕迹 / 无关图片。其他内容（学分大小等）不严格校验。
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

    const { data: studentProfile } = await admin
      .from("profiles")
      .select("full_name, student_no")
      .eq("user_id", app.student_id)
      .single();

    const { data: rules } = await admin
      .from("rules")
      .select("id, name, project, achievement, level, identity, credit")
      .eq("active", true);

    // 找出与申请关键词最契合的规则（用于建议学分）
    const selected: string[] = app.selected_keywords ?? [];
    const custom: string[] = app.custom_keywords ?? [];
    const candidate = rules?.find((r) =>
      [r.project, r.achievement, r.level, r.identity].filter(Boolean).every((v) => selected.includes(v as string))
    ) ?? null;

    // 拉取与本次申请关键词相关的人工通过案例（教师覆盖系统驳回时沉淀）
    const allKw = [...selected, ...custom];
    const { data: allCases } = await admin
      .from("cases")
      .select("title, summary, awarded_credit, rule_id")
      .order("created_at", { ascending: false })
      .limit(50);
    const relatedCases = (allCases ?? []).filter((c) => {
      const blob = `${c.title}\n${c.summary}`;
      return allKw.some((kw) => kw && blob.includes(kw));
    }).slice(0, 5);

    // 下载附件图片
    let imageDataUrl: string | null = null;
    let attachmentNote = "无附件";
    if (app.file_path) {
      if (IMAGE_EXT.test(app.file_path)) {
        const { data: blob, error: dlErr } = await admin.storage
          .from("application-files")
          .download(app.file_path);
        if (!dlErr && blob) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
          const b64 = btoa(bin);
          const ext = app.file_path.split(".").pop()!.toLowerCase();
          const mime = ext === "jpg" ? "jpeg" : ext;
          imageDataUrl = `data:image/${mime};base64,${b64}`;
          attachmentNote = "已附图片";
        } else {
          attachmentNote = "附件下载失败";
        }
      } else {
        attachmentNote = `非图片附件 (${app.file_path.split(".").pop()})，未做视觉核验`;
      }
    }

    const systemPrompt = `你是大学学分材料核验助手。

【认定范围参考】本科生创新实践学分的认定范围包括：科研成果（论文）、知识产权、科研训练（科研项目 / 大创项目）、学科竞赛、职业技能证书（英语 / 计算机 / 职业证书）、创业实践、文体竞赛、第二课堂等。如果材料明显落在以上范围之内，应优先按相应类别识别。

你只负责四件事，其他内容（学分多少、规则归类是否最优等）不要严格判断：
1. 材料与关键词一致性：图片/文件展示的内容（证书名称、奖项、级别、身份）是否与学生选择的关键词描述一致。
2. 是否无关图片：图片是否完全与申请主题无关（如随手拍、风景、聊天截图）。
3. 篡改 / AI 生成痕迹：是否有明显 PS、拼接、字体不一致、AI 生成（不自然纹理、伪造印章、扭曲文字）等痕迹。
4. 姓名匹配：图片中获奖人 / 持证人姓名是否与系统记录的学生姓名一致；多人合作奖项，姓名出现在名单中即可。

判定规则：
- 四项都没有问题 → recommendation=approve, confidence≥0.85
- 任一项明显有问题 → recommendation=reject, confidence≥0.85，reasoning 必须详细列出问题（中文 3-6 句，逐项说明哪一项出问题、依据是什么）
- 模糊不清 / 文件缺失 / 无法判断 → recommendation=review, confidence 0.4~0.7，说明缺什么
- 没有附件时只能基于文字说明判断材料-关键词一致性，无法核验姓名/篡改 → 默认 recommendation=review

reasoning 必须用中文，结构：「材料一致性：…；图片相关性：…；真实性：…；姓名匹配：…；结论：…」

如果"参考案例"中存在与本次申请关键词高度相似且已被人工通过的案例，可作为放宽判断的依据：当四项核验只是模糊不确定（非明显造假）时，倾向于 approve 或 review，而不是直接 reject。`;

如果"参考案例"中存在与本次申请关键词高度相似且已被人工通过的案例，可作为放宽判断的依据：当四项核验只是模糊不确定（非明显造假）时，倾向于 approve 或 review，而不是直接 reject。`;

    const userPayload = {
      student: {
        name: studentProfile?.full_name ?? "未知",
        student_no: studentProfile?.student_no ?? "未知",
      },
      application: {
        description: app.description,
        selected_keywords: selected,
        custom_keywords: custom,
        attachment: attachmentNote,
      },
      candidate_rule: candidate
        ? { id: candidate.id, name: candidate.name, credit: candidate.credit }
        : null,
      reference_cases: relatedCases.map((c) => ({
        title: c.title,
        summary: c.summary,
        awarded_credit: c.awarded_credit,
      })),
    };

    const userContent: unknown[] = [{ type: "text", text: JSON.stringify(userPayload) }];
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
              description: "提交材料核验结果",
              parameters: {
                type: "object",
                properties: {
                  consistency_ok: { type: "boolean", description: "材料是否与关键词一致" },
                  relevance_ok: { type: "boolean", description: "图片是否与申请相关" },
                  authenticity_ok: { type: "boolean", description: "是否无篡改/AI 生成痕迹" },
                  name_match_ok: { type: ["boolean", "null"], description: "姓名是否匹配，无附件时为 null" },
                  confidence: { type: "number" },
                  recommendation: { type: "string", enum: ["approve", "review", "reject"] },
                  reasoning: { type: "string" },
                },
                required: ["consistency_ok", "relevance_ok", "authenticity_ok", "name_match_ok", "confidence", "recommendation", "reasoning"],
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
      if (aiResp.status === 429) return json({ error: "系统繁忙，请稍后再试" }, 429);
      return json({ error: `系统核验失败: ${t.slice(0, 200)}` }, 500);
    }

    const aiJson = await aiResp.json();
    const call = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      console.error("Qwen unexpected payload:", JSON.stringify(aiJson).slice(0, 500));
      return json({ error: "系统返回格式错误" }, 500);
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

    const matchedRuleId = candidate?.id ?? null;
    const suggestedCredit = candidate?.credit ?? null;

    await admin.from("application_reviews").insert({
      application_id,
      reviewer_id: null,
      action: "ai_evaluation",
      decision: nextStatus,
      credit: suggestedCredit,
      confidence: result.confidence,
      matched_rule_id: matchedRuleId,
      note: result.reasoning,
    });

    // 系统通过时直接落实学分，无需教师确认；教师仍可在详情页修改
    const isAutoApproved = nextStatus === "auto_approved";
    await admin
      .from("applications")
      .update({
        status: nextStatus,
        ai_matched_rule_id: matchedRuleId,
        ai_suggested_credit: suggestedCredit,
        ai_confidence: result.confidence,
        ai_reasoning: result.reasoning,
        final_credit: isAutoApproved ? suggestedCredit : null,
        reviewed_at: isAutoApproved ? new Date().toISOString() : null,
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
