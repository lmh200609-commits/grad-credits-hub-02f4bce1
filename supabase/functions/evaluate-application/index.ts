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
    // 服务端按关键词 ilike 匹配，避免数千案例时漏检 / 超量传输
    let relatedCases: Array<{ title: string; summary: string; awarded_credit: number | null }> = [];
    const cleanedKw = allKw.filter((k) => k && k.trim().length > 0).slice(0, 8);
    if (cleanedKw.length) {
      const orExpr = cleanedKw
        .flatMap((k) => [`title.ilike.%${k}%`, `summary.ilike.%${k}%`])
        .join(",");
      const { data: matched } = await admin
        .from("cases")
        .select("title, summary, awarded_credit")
        .or(orExpr)
        .order("created_at", { ascending: false })
        .limit(5);
      relatedCases = (matched as typeof relatedCases) ?? [];
    }

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

【认定范围参考】本科生创新实践学分的认定范围包括：科研成果（论文）、知识产权、科研训练（科研项目 / 大创项目）、学科竞赛、职业技能证书、创业实践、文体竞赛、第二课堂等。

你需要做两类工作：

A. 四项核验：
1. 材料与关键词一致性：图片/文件展示的内容（证书名称、奖项、级别、身份）是否与学生选择的关键词完全一致。**关键：级别、身份、奖项等级有任何差异都算不一致**。例如学生选"国家级一等奖"但图片是"省级三等奖"，即使都是竞赛类，consistency_ok 也必须 = false。
2. 是否无关图片：图片是否完全与申请主题无关。
3. 篡改 / AI 生成痕迹：是否有明显 PS、拼接、AI 生成痕迹。
4. 姓名匹配：图片中姓名是否与学生姓名一致。

B. 从图片中实际识别的属性（detected_*）：无论关键词写什么，基于图片真实内容填写：
- detected_project：项目大类（科研成果/知识产权/科研训练/学科竞赛/职业技能证书/创业实践/文体竞赛/第二课堂等）
- detected_achievement：成果细类（如"论文"、"专利"、"大创项目"、"英语"等）
- detected_level：级别（如"国家级一等奖"、"省级二等奖"、"校级"、"六级"、"SCI"等）
- detected_identity：身份（如"第一作者"、"主持人"、"第一参与人"等），无概念填 null
无附件或无法识别时填 null。

判定规则：
- 四项都没问题且 detected_* 与关键词的级别/身份/成果一致 → approve, confidence≥0.85
- consistency_ok=false（含 detected 与关键词不符）或明显造假 → reject, confidence≥0.85
- 模糊/缺文件/无法判断 → review, confidence 0.4~0.7
- 无附件 → 默认 review

reasoning 中文，结构：「材料一致性：…；图片相关性：…；真实性：…；姓名匹配：…；图片实际识别：项目=…，成果=…，级别=…，身份=…；结论：…」`;

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
                  consistency_ok: { type: "boolean", description: "材料是否与关键词一致（含级别/身份精确匹配）" },
                  relevance_ok: { type: "boolean", description: "图片是否与申请相关" },
                  authenticity_ok: { type: "boolean", description: "是否无篡改/AI 生成痕迹" },
                  name_match_ok: { type: ["boolean", "null"], description: "姓名是否匹配，无附件时为 null" },
                  detected_project: { type: ["string", "null"], description: "图片中实际识别到的项目大类" },
                  detected_achievement: { type: ["string", "null"], description: "图片中实际识别到的成果细类" },
                  detected_level: { type: ["string", "null"], description: "图片中实际识别到的级别" },
                  detected_identity: { type: ["string", "null"], description: "图片中实际识别到的身份" },
                  confidence: { type: "number" },
                  recommendation: { type: "string", enum: ["approve", "review", "reject"] },
                  reasoning: { type: "string" },
                },
                required: ["consistency_ok", "relevance_ok", "authenticity_ok", "name_match_ok", "detected_project", "detected_achievement", "detected_level", "detected_identity", "confidence", "recommendation", "reasoning"],
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

    // 用 AI 从图片中识别到的真实属性重新匹配规则（防止学生选高分关键词配低级别证书）
    const detected = {
      project: result.detected_project as string | null,
      achievement: result.detected_achievement as string | null,
      level: result.detected_level as string | null,
      identity: result.detected_identity as string | null,
    };
    const hasDetection = !!(detected.project || detected.achievement || detected.level);
    const detectedRule = hasDetection
      ? rules?.find((r) => {
          const dims = [
            [r.project, detected.project],
            [r.achievement, detected.achievement],
            [r.level, detected.level],
            [r.identity, detected.identity],
          ] as const;
          // 规则中非空的维度必须与 detected 完全一致；规则中为空的维度跳过
          return dims.every(([rv, dv]) => !rv || (dv && (dv === rv || dv.includes(rv as string) || (rv as string).includes(dv))));
        }) ?? null
      : null;

    // 优先使用 detected 匹配的规则；若 detected 与学生关键词派生的 candidate 不一致，强制走人工复核
    const effectiveRule = detectedRule ?? candidate;
    const detectedMismatch = hasDetection && candidate && detectedRule && detectedRule.id !== candidate.id;

    let nextStatus: string;
    if (detectedMismatch) {
      // 学生选的关键词与图片识别结果对应不同规则 → 不能自动通过
      nextStatus = result.recommendation === "reject" ? "rejected_by_ai" : "pending_review";
    } else if (result.recommendation === "approve" && result.confidence >= HIGH_CONFIDENCE) {
      nextStatus = "auto_approved";
    } else if (result.recommendation === "reject" && result.confidence >= HIGH_CONFIDENCE) {
      nextStatus = "rejected_by_ai";
    } else {
      nextStatus = "pending_review";
    }

    const matchedRuleId = effectiveRule?.id ?? null;
    const suggestedCredit = effectiveRule?.credit ?? null;

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
