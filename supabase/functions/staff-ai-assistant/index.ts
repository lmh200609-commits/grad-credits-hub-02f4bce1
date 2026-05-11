import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAiConfig } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Msg = { role: "user" | "assistant" | "system" | "tool"; content: string; tool_call_id?: string; name?: string; tool_calls?: any[] };
import { normalizeMarkdown, toSections, shouldPolish, callPolish } from "../_shared/format-answer.ts";

const SYSTEM_PROMPT = `你是「教师/管理员工作助手」，仅为学校学分认定系统的教师与管理员服务。

【你的能力】
你可以调用以下工具完成用户的指令：
- navigate_to(path)：跳转到系统内的某个页面
- find_student(query)：根据姓名/学号/班级模糊查询学生
- list_failing_students(threshold)：列出累计学分低于阈值（默认 4）的学生
- student_full_profile(query)：根据姓名/学号定位单个学生，返回实名档案（含身份证、专业班级、联系方式）+ 累计学分 + 申请数
- student_submission_history(student_no_or_name, limit?)：查询某学生历次提交的申请清单（含 AI 初审与教师复核结论），以学号/姓名为锚
- submission_timeline(application_id)：查询单份申请的完整事件时间线（提交→AI审→教师审→...）
- certificate_type_lookup(keyword)：在「证书类型字典」中检索证书/成果类型，返回典型学分、关联规则数、关联案例数
- account_provenance(query)：根据姓名/学号查询某账号的导入来源（谁、什么时候、用什么文件导入），数据来自 audit_logs
- query_stats(metric)：查询统计数据。可用 metric：
    · pending_review        — 待人工复核的申请数
    · pending_ai            — 系统核验中的申请数
    · approved_week         — 近 7 天人工复核通过数
    · rejected_week         — 近 7 天驳回数
    · total_students        — 学生总人数
    · total_apps_month      — 近 30 天提交申请数
    · submitted_total       — 累计提交过申请的去重学生人数
    · submitted_count       — 累计申请总数
    · passed_students       — 累计学分 ≥ 4 的学生人数（合格）
    · failing_students      — 累计学分 < 4 的学生人数（不合格）
    · auto_approved_total   — 系统初审自动通过的申请数
    · manual_approved_total — 人工复核通过的申请数
    · rejected_total        — 累计驳回数（含系统驳回 + 人工驳回）
    · rules_overview        — 规则库总数 + 按类别/级别/适用身份分布
    · cases_overview        — 案例库总数 + 关联规则数
    · keywords_overview     — 关键词库总数（含启用/停用拆分）+ 按类别分布
    · certificate_types_overview — 证书类型字典总数 + 按类别/级别分布
    · submission_records_overview — 申请流水总数 + 按事件类型分布

【路径白名单（仅可使用以下路径）】
- /admin/dashboard           数据看板（管理员）
- /teacher/dashboard         数据看板（教师）
- /admin/review              复核中心
- /admin/credits             学分排名-管理员（支持 ?passFilter=fail|pass|all、?dept=xxx）
- /teacher/credits           学分排名-教师（支持 ?passFilter=fail|pass|all、?dept=xxx）
- /admin/users/students      学生管理（支持 ?search=xxx）
- /admin/users/teachers      教师管理
- /admin/rules               规则库
- /admin/cases               案例库
- /admin/import              批量导入
- /admin/audit-logs          审计日志
- /reviews                   审核列表（支持 ?status=pending_review 等）
- /teacher/students          教师学生列表
- /teacher/students/{id}     学生档案
- /applications/{id}         单个申请详情

【行为约束】
1. 只能调用上面定义的工具，禁止臆造其他工具或路径。
2. 如果用户请求"查看 XX 档案"但姓名有多人匹配，先调用 find_student 拿到候选，让用户选择，不要擅自跳转。
3. 如果用户请求与学分系统无关，礼貌拒绝并提醒可用功能。
4. 回答简洁，不超过两句话；执行动作时直接调工具，不要冗长解释。
5. 教师角色不要给出"管理员后台"建议；管理员角色可访问全部页面。
6. 【严禁幻觉】凡涉及任何数量、人数、统计的提问（"多少人"、"几个"、"提交了多少"、"合格/不合格人数"、"通过/驳回数"等），必须先调用 query_stats（或对应工具如 list_failing_students）拿到真实数字，绝不允许凭对话上下文、记忆或推测给出数字。
7. 如果用户问的统计指标不在上面 metric 列表中，回复"暂不支持该统计"，不要编造。
8. 【数据来源严格基于数据库】凡涉及具体学生、申请、证书类型、AI/教师审核内容，必须先调用对应工具读取数据库。工具返回为空时必须明确回复"数据库中暂无相关记录"，绝不编造姓名、学号、学分、审核意见、证书类型、典型学分等任何细节。
9. 询问"某学生的资料/记录/申请/AI审/教师审"时，优先用 student_full_profile + student_submission_history；询问"某次申请怎么走的"用 submission_timeline；询问"某证书几学分/属于哪类"用 certificate_type_lookup。`;

const PROVENANCE_RULE = `\n11. 询问"某账号是谁导入的/什么时候创建的/什么时候导入的/导入来源/由谁创建"等问题，必须先调用 account_provenance；返回为空时如实回答"审计日志中没有该账号的导入记录"，绝不猜测。同名多人时把所有候选连同学号、院系、导入时间、导入人一并列出，提示用学号区分。`;

const AIGC_RULE = `\n12. 涉及"AI 生成 / AIGC / 疑似 AI 图片 / 假图 / AI 鉴别"等任何统计问题：默认必须调用 query_stats(metric="aigc_overview")，它会一次性返回 fake/suspect/real/pending/skipped/error 全量计数 + 本周 fake / 本周 suspect + 平均概率。禁止只查 suspect 不查 fake；禁止回答"暂未提供该指标"。如果用户只问"本周疑似" 也仍然要返回 aigc_overview 中 week_fake + week_suspect 的合计，并明确分别多少条。需要按学生列名单时再调 list_aigc_flagged。结果为空才回答"当前范围内无相关记录"，禁止编造。
12.1 输出 list_aigc_flagged 结果时，禁止使用 markdown 表格（容易渲染成一整行乱码）。统一用如下无序列表格式，每条占一行：
- 学生姓名（学号） · 状态 · 概率 X% · 提交时间 YYYY-MM-DD HH:mm · 申请编号末 8 位
提交时间只保留到分钟；申请编号只显示末 8 位（如 a994cfc5）。`;

const CHINESE_ONLY_RULE = `\n13. 全程使用纯简体中文回答。严禁在用户可见文本中出现任何英文字段名、英文枚举值、英文表名、英文变量名（包括但不限于 aigc_status / aigc_score / aigc_score_pct / submitted_at / student_id / student_no / student_name / application_id / college_id / fake / suspect / real / pending / skipped / error / approved / rejected / pending_ai / pending_review / auto_approved / rejected_by_ai / applications / profiles / user_roles）。必须翻译为中文：
- 状态：fake→高风险，suspect→嫌疑，real→通过，pending→待检测，skipped→跳过，error→检测失败；approved→已通过，auto_approved→系统自动通过，rejected→已驳回，rejected_by_ai→AI 初审驳回，pending_ai→AI 审中，pending_review→待教师复核。
- 字段：aigc_score / aigc_score_pct→AI 生成概率；submitted_at→提交时间；student_no→学号；student_name→姓名；application_id→申请编号（仅展示末 8 位）；college_id→学院；description→申请描述。
如必须保留原始申请编号，只展示末 8 位（例如 a994cfc5），不要整段 UUID。`;

const NO_PATH_RULE = `\n14. 当工具返回 navigate_path 或你已请求 navigate_to 时，前端会自动渲染"跳转"按钮。回答正文中严禁出现任何 URL、路径片段（包括 /admin/...、/teacher/...、/applications/... 等）和英文查询参数（如 ?passFilter=fail、?status=pending_review、?dept=xxx）。请只用一句简体中文描述用户应该做什么，例如"已为你定位到不合格学生名单，可点击下方按钮进入"或"已找到对应申请，点击下方按钮查看详情"。禁止把路径作为代码块、行内代码或纯文本展示给用户。`;

// 兜底：从模型最终答复中剥离裸 URL / 路径片段 / markdown 链接，避免出现 "/admin/credits?passFilter=fail" 这类英文路径
function stripPathsFromAnswer(text: string): string {
  if (!text) return text;
  let out = text;
  // markdown 链接 [文本](/path) -> 文本
  out = out.replace(/\[([^\]]+)\]\((?:https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, "$1");
  // 行内/裸链接：http(s)://...
  out = out.replace(/https?:\/\/\S+/g, "");
  // 行内反引号包裹的路径 `/admin/xxx`
  out = out.replace(/`\/[A-Za-z0-9_\-/?=&%.]+`/g, "");
  // 裸路径 /admin/credits?passFilter=fail 等
  out = out.replace(/(^|[\s（(：:，,。;；])\/[A-Za-z][A-Za-z0-9_\-/]*(?:\?[A-Za-z0-9_\-=&%.]+)?/g, "$1");
  // 裸 query 串 ?passFilter=fail
  out = out.replace(/\?[A-Za-z][A-Za-z0-9_\-]*=\S+/g, "");
  // 清理冒号后空白、双空格、孤立标点
  out = out.replace(/[：:]\s*(?=$|[\n。；;])/gm, "");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

const IDENTITY_RULE = `\n10. 当用户问"我是谁/我叫什么/我什么角色/我哪个学院/我哪个部门/我邮箱"等关于自身身份的问题时，必须严格基于下方系统消息中"当前登录用户"段落如实回答（姓名、角色、所属学院等），绝不允许说不知道或编造。`;

const FORMAT_GUIDE = `\n\n【输出格式】使用 markdown：第一行一句结论；之后用 ## 二级标题分段；列表用 -；并列信息 ≥5 行必须用表格。禁止一级标题、emoji、分割线、整篇代码块、寒暄过程语（如"我将为您查询…"）。
严禁使用 **加粗**、__加粗__、*斜体* 等 markdown 强调符号；严禁使用 ⚠️📎👇✅❌🎉🤖 等装饰 emoji 和 1️⃣2️⃣3️⃣ 等带圈数字。需要强调时直接用「」或换行。`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "navigate_to",
      description: "跳转到系统内的某个页面（必须来自路径白名单）",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "完整路径，含 query string（如 /admin/credits?passFilter=fail）" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_student",
      description: "根据姓名/学号/班级/专业模糊查询学生，返回候选列表供用户选择",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "搜索关键词" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_failing_students",
      description: "列出累计学分不达标的学生",
      parameters: {
        type: "object",
        properties: { threshold: { type: "number", description: "学分阈值，默认 4" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_stats",
      description: "查询常用统计数字",
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: [
              "pending_review",
              "pending_ai",
              "approved_week",
              "rejected_week",
              "total_students",
              "total_apps_month",
              "submitted_total",
              "submitted_count",
              "passed_students",
              "failing_students",
              "auto_approved_total",
              "manual_approved_total",
              "rejected_total",
              "rules_overview",
              "cases_overview",
              "keywords_overview",
              "certificate_types_overview",
              "submission_records_overview",
              "aigc_fake_week",
              "aigc_suspect_week",
              "aigc_pending_total",
              "aigc_overview",
            ],
          },
        },
        required: ["metric"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "student_full_profile",
      description: "根据姓名或学号精确定位学生，返回完整实名档案 + 累计学分 + 申请数。仅返回最相关的一条；如多条匹配请改用 find_student。",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "学号或姓名（精确优先）" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "student_submission_history",
      description: "查询某学生历次提交的申请清单，含每份申请的 AI 初审结论和教师复核结论",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "学号或姓名" },
          limit: { type: "number", description: "返回条数，默认 10" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submission_timeline",
      description: "查询单份申请的完整事件流水（提交→AI审→教师审...）",
      parameters: {
        type: "object",
        properties: { application_id: { type: "string" } },
        required: ["application_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "certificate_type_lookup",
      description: "在证书类型字典中检索类型（如 SCI论文/英语六级/计算机高级），返回典型学分与关联规则/案例数",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string" } },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "account_provenance",
      description: "查询某账号是谁、什么时候、用什么文件导入的。来源为 audit_logs 中的 import_users 事件。入参为姓名或学号。",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "姓名或学号" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_aigc_flagged",
      description: "列出疑似 AI 生成图片材料的申请（aigc_status 为 fake/suspect），按概率倒序，最多 20 条。用于回答『本周/本月有哪些学生疑似提交 AI 图片』。",
      parameters: {
        type: "object",
        properties: {
          range: { type: "string", enum: ["week", "month"], description: "时间窗，默认 week" },
          status: { type: "string", enum: ["fake", "suspect", "both"], description: "默认 both" },
        },
      },
    },
  },
];

type CallerCtx = {
  userRole: string; // 'super_admin' | 'admin' | 'teacher'
  collegeId: string | null;
  isSuper: boolean;
};

async function execTool(
  name: string,
  args: any,
  supabase: ReturnType<typeof createClient>,
  ctx: CallerCtx,
) {
  const { userRole, collegeId, isSuper } = ctx;
  // 在调用方为学院管理员/教师时，把所有学院范围内的 student user_id 预取出来，
  // 用于过滤没有 college_id 列的表（如 user_roles 已有，但 application_reviews 没有）。
  const fetchScopedStudentIds = async (): Promise<string[] | null> => {
    if (isSuper || !collegeId) return null;
    const { data } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "student")
      .eq("college_id", collegeId);
    return Array.from(new Set((data || []).map((r: any) => r.user_id))).filter(Boolean);
  };
  if (name === "navigate_to") {
    return { ok: true, path: String(args?.path || "") };
  }

  if (name === "find_student") {
    const q = String(args?.query || "").trim();
    if (!q) return { candidates: [] };
    let pq = supabase
      .from("profiles")
      .select("user_id, full_name, student_no, department, class_name, major, college_id")
      .or(
        `full_name.ilike.%${q}%,student_no.ilike.%${q}%,class_name.ilike.%${q}%,major.ilike.%${q}%`,
      )
      .limit(10);
    if (!isSuper && collegeId) pq = pq.eq("college_id", collegeId);
    const { data: profiles } = await pq;
    const ids = (profiles || []).map((p: any) => p.user_id);
    let students: any[] = [];
    if (ids.length) {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("user_id", ids)
        .eq("role", "student");
      const sset = new Set((roles || []).map((r: any) => r.user_id));
      students = (profiles || []).filter((p: any) => sset.has(p.user_id));
    }
    return { candidates: students };
  }

  if (name === "list_failing_students") {
    const threshold = Number(args?.threshold ?? 4);
    let rq = supabase.from("user_roles").select("user_id").eq("role", "student");
    if (!isSuper && collegeId) rq = rq.eq("college_id", collegeId);
    const { data: roles } = await rq;
    const ids = new Set((roles || []).map((r: any) => r.user_id));
    let aq = supabase
      .from("applications")
      .select("student_id, status, final_credit, ai_suggested_credit");
    if (!isSuper && collegeId) aq = aq.eq("college_id", collegeId);
    const { data: apps } = await aq;
    const credit = new Map<string, number>();
    (apps || []).forEach((a: any) => {
      if (!["approved", "auto_approved"].includes(a.status)) return;
      const c = Number(a.final_credit ?? a.ai_suggested_credit ?? 0);
      credit.set(a.student_id, (credit.get(a.student_id) ?? 0) + c);
    });
    const failingIds = Array.from(ids).filter((id: any) => (credit.get(id) ?? 0) < threshold);
    const base = userRole === "teacher" ? "/teacher/credits" : "/admin/credits";
    return {
      threshold,
      failing_count: failingIds.length,
      total_students: ids.size,
      navigate_path: `${base}?passFilter=fail`,
    };
  }

  if (name === "query_stats") {
    const metric = String(args?.metric || "");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
    // 学院范围过滤助手
    const scopeApps = (q: any) => (!isSuper && collegeId ? q.eq("college_id", collegeId) : q);
    const scopeProfiles = (q: any) => (!isSuper && collegeId ? q.eq("college_id", collegeId) : q);
    const scopeRoles = (q: any) => (!isSuper && collegeId ? q.eq("college_id", collegeId) : q);
    // 仅当作用域内学生 ID 已知时使用（应对没有 college_id 的表，如 application_reviews）
    let scopedStudentIds: string[] | null | undefined = undefined;
    const ensureStudentIds = async () => {
      if (scopedStudentIds === undefined) scopedStudentIds = await fetchScopedStudentIds();
      return scopedStudentIds; // null 表示超管（不过滤）
    };
    if (metric === "pending_review") {
      const { count } = await scopeApps(
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
      );
      return { metric, value: count ?? 0, navigate_path: "/reviews?status=pending_review" };
    }
    if (metric === "approved_week") {
      // application_reviews 没有 college_id；先按 application 取本学院 ids 再过滤
      let appScope: string[] | null = null;
      if (!isSuper && collegeId) {
        const { data: aids } = await supabase
          .from("applications").select("id").eq("college_id", collegeId);
        appScope = (aids || []).map((r: any) => r.id);
        if (appScope.length === 0) return { metric, value: 0 };
      }
      let q = supabase
        .from("application_reviews")
        .select("application_id")
        .eq("decision", "approved")
        .gte("created_at", weekAgo.toISOString());
      if (appScope) q = q.in("application_id", appScope);
      const { data } = await q;
      const set = new Set((data || []).map((r: any) => r.application_id));
      return { metric, value: set.size };
    }
    if (metric === "rejected_week") {
      let appScope: string[] | null = null;
      if (!isSuper && collegeId) {
        const { data: aids } = await supabase
          .from("applications").select("id").eq("college_id", collegeId);
        appScope = (aids || []).map((r: any) => r.id);
        if (appScope.length === 0) return { metric, value: 0 };
      }
      let q = supabase
        .from("application_reviews")
        .select("application_id")
        .eq("decision", "rejected")
        .gte("created_at", weekAgo.toISOString());
      if (appScope) q = q.in("application_id", appScope);
      const { data } = await q;
      const set = new Set((data || []).map((r: any) => r.application_id));
      return { metric, value: set.size };
    }
    if (metric === "total_students") {
      const { count } = await scopeRoles(
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "student"),
      );
      return { metric, value: count ?? 0 };
    }
    if (metric === "total_apps_month") {
      const { count } = await scopeApps(
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("submitted_at", monthAgo.toISOString()),
      );
      return { metric, value: count ?? 0 };
    }
    if (metric === "pending_ai") {
      const { count } = await scopeApps(
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "pending_ai"),
      );
      return { metric, value: count ?? 0 };
    }
    if (metric === "submitted_total") {
      const { data } = await scopeApps(supabase.from("applications").select("student_id"));
      const set = new Set((data || []).map((r: any) => r.student_id));
      return { metric, value: set.size, navigate_path: userRole === "teacher" ? "/teacher/students" : "/admin/users/students" };
    }
    if (metric === "submitted_count") {
      const { count } = await scopeApps(supabase.from("applications").select("id", { count: "exact", head: true }));
      return { metric, value: count ?? 0 };
    }
    if (metric === "submitted_students_week") {
      const { data } = await scopeApps(
        supabase.from("applications").select("student_id").gte("submitted_at", weekAgo.toISOString()),
      );
      const set = new Set((data || []).map((r: any) => r.student_id));
      return { metric, value: set.size, range: "week", navigate_path: userRole === "teacher" ? "/teacher/students" : "/admin/users/students" };
    }
    if (metric === "submitted_count_week") {
      const { count } = await scopeApps(
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("submitted_at", weekAgo.toISOString()),
      );
      return { metric, value: count ?? 0, range: "week" };
    }
    if (metric === "submitted_students_month") {
      const { data } = await scopeApps(
        supabase.from("applications").select("student_id").gte("submitted_at", monthAgo.toISOString()),
      );
      const set = new Set((data || []).map((r: any) => r.student_id));
      return { metric, value: set.size, range: "month" };
    }
    if (metric === "passed_students" || metric === "failing_students") {
      const threshold = 4;
      const { data: roles } = await scopeRoles(
        supabase.from("user_roles").select("user_id").eq("role", "student"),
      );
      const ids = new Set((roles || []).map((r: any) => r.user_id));
      const { data: apps } = await scopeApps(
        supabase.from("applications").select("student_id, status, final_credit, ai_suggested_credit"),
      );
      const credit = new Map<string, number>();
      (apps || []).forEach((a: any) => {
        if (!["approved", "auto_approved"].includes(a.status)) return;
        const c = Number(a.final_credit ?? a.ai_suggested_credit ?? 0);
        credit.set(a.student_id, (credit.get(a.student_id) ?? 0) + c);
      });
      const passing = Array.from(ids).filter((id: any) => (credit.get(id) ?? 0) >= threshold).length;
      const failing = ids.size - passing;
      const value = metric === "passed_students" ? passing : failing;
      const base = userRole === "teacher" ? "/teacher/credits" : "/admin/credits";
      return {
        metric,
        value,
        threshold,
        navigate_path: `${base}?passFilter=${metric === "passed_students" ? "pass" : "fail"}`,
      };
    }
    if (metric === "auto_approved_total") {
      const { count } = await scopeApps(
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "auto_approved"),
      );
      return { metric, value: count ?? 0 };
    }
    if (metric === "manual_approved_total") {
      const { count } = await scopeApps(
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "approved"),
      );
      return { metric, value: count ?? 0 };
    }
    if (metric === "rejected_total") {
      const { count } = await scopeApps(
        supabase.from("applications")
          .select("id", { count: "exact", head: true })
          .in("status", ["rejected", "rejected_by_ai"]),
      );
      return { metric, value: count ?? 0 };
    }
    if (metric === "rules_overview") {
      const { data: rules } = await supabase
        .from("rules")
        .select("category,level,identity,active")
        .eq("active", true);
      const byCategory: Record<string, number> = {};
      const byLevel: Record<string, number> = {};
      const byIdentity: Record<string, number> = {};
      (rules || []).forEach((r: any) => {
        const c = (r.category || "未分类").trim() || "未分类";
        const l = (r.level || "未指定").trim() || "未指定";
        const id = (r.identity || "未指定").trim() || "未指定";
        byCategory[c] = (byCategory[c] || 0) + 1;
        byLevel[l] = (byLevel[l] || 0) + 1;
        byIdentity[id] = (byIdentity[id] || 0) + 1;
      });
      return {
        metric,
        value: rules?.length ?? 0,
        category_count: Object.keys(byCategory).length,
        by_category: byCategory,
        by_level: byLevel,
        by_identity: byIdentity,
        navigate_path: "/admin/rules",
      };
    }
    if (metric === "cases_overview") {
      const { data: cases } = await supabase.from("cases").select("rule_id");
      const ruleIds = new Set((cases || []).map((c: any) => c.rule_id).filter(Boolean));
      return {
        metric,
        value: cases?.length ?? 0,
        linked_rule_count: ruleIds.size,
        navigate_path: "/admin/cases",
      };
    }
    if (metric === "keywords_overview") {
      const { data: kws } = await supabase.from("keywords").select("category,active");
      const total = kws?.length ?? 0;
      let active = 0;
      const byCategory: Record<string, number> = {};
      (kws || []).forEach((k: any) => {
        if (k.active) active++;
        const c = (k.category || "未分类").trim() || "未分类";
        byCategory[c] = (byCategory[c] || 0) + 1;
      });
      return {
        metric,
        value: total,
        active,
        inactive: total - active,
        by_category: byCategory,
        navigate_path: "/admin/keywords",
      };
    }
    if (metric === "certificate_types_overview") {
      const { data: cts } = await supabase.from("certificate_types").select("category,level,active");
      const total = cts?.length ?? 0;
      let active = 0;
      const byCategory: Record<string, number> = {};
      const byLevel: Record<string, number> = {};
      (cts || []).forEach((c: any) => {
        if (c.active) active++;
        const cat = (c.category || "未分类").trim() || "未分类";
        const lv = (c.level || "未指定").trim() || "未指定";
        byCategory[cat] = (byCategory[cat] || 0) + 1;
        byLevel[lv] = (byLevel[lv] || 0) + 1;
      });
      return { metric, value: total, active, inactive: total - active, by_category: byCategory, by_level: byLevel };
    }
    if (metric === "submission_records_overview") {
      const { data: rs } = await supabase.from("submission_records").select("event_type");
      const total = rs?.length ?? 0;
      const byEvent: Record<string, number> = {};
      (rs || []).forEach((r: any) => {
        const e = r.event_type || "unknown";
        byEvent[e] = (byEvent[e] || 0) + 1;
      });
      return { metric, value: total, by_event: byEvent };
    }
    if (metric === "aigc_fake_week") {
      const { count } = await scopeApps(
        supabase.from("applications")
          .select("id", { count: "exact", head: true })
          .eq("aigc_status", "fake")
          .gte("submitted_at", weekAgo.toISOString()),
      );
      return { metric, value: count ?? 0, range: "week" };
    }
    if (metric === "aigc_suspect_week") {
      const { count } = await scopeApps(
        supabase.from("applications")
          .select("id", { count: "exact", head: true })
          .eq("aigc_status", "suspect")
          .gte("submitted_at", weekAgo.toISOString()),
      );
      return { metric, value: count ?? 0, range: "week" };
    }
    if (metric === "aigc_pending_total") {
      const { count } = await scopeApps(
        supabase.from("applications")
          .select("id", { count: "exact", head: true })
          .eq("aigc_status", "pending"),
      );
      return { metric, value: count ?? 0 };
    }
    if (metric === "aigc_overview") {
      const statuses = ["fake", "suspect", "real", "pending", "skipped", "error"] as const;
      const counts: Record<string, number> = {};
      for (const s of statuses) {
        const { count } = await scopeApps(
          supabase.from("applications")
            .select("id", { count: "exact", head: true })
            .eq("aigc_status", s),
        );
        counts[s] = count ?? 0;
      }
      const { count: weekFake } = await scopeApps(
        supabase.from("applications")
          .select("id", { count: "exact", head: true })
          .eq("aigc_status", "fake")
          .gte("submitted_at", weekAgo.toISOString()),
      );
      const { count: weekSuspect } = await scopeApps(
        supabase.from("applications")
          .select("id", { count: "exact", head: true })
          .eq("aigc_status", "suspect")
          .gte("submitted_at", weekAgo.toISOString()),
      );
      const { data: scored } = await scopeApps(
        supabase.from("applications")
          .select("aigc_score")
          .not("aigc_score", "is", null),
      );
      const arr = (scored ?? []).map((r: any) => Number(r.aigc_score)).filter((n) => !isNaN(n));
      const avg = arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0;
      return {
        指标: "AI 生成材料鉴别概览",
        累计高风险: counts.fake,
        累计嫌疑: counts.suspect,
        累计通过: counts.real,
        待检测: counts.pending,
        跳过: counts.skipped,
        检测失败: counts.error,
        本周高风险: weekFake ?? 0,
        本周嫌疑: weekSuspect ?? 0,
        平均AI生成概率: `${(avg * 100).toFixed(1)}%`,
      };
    }
    return { metric, value: 0 };
  }

  if (name === "list_aigc_flagged") {
    const range = String(args?.range || "week");
    const status = String(args?.status || "both");
    const since = new Date();
    since.setDate(since.getDate() - (range === "month" ? 30 : 7));
    const statusFilter =
      status === "fake" ? ["fake"] : status === "suspect" ? ["suspect"] : ["fake", "suspect"];
    let aq = supabase
      .from("applications")
      .select("id, student_id, aigc_status, aigc_score, submitted_at, description")
      .in("aigc_status", statusFilter)
      .gte("submitted_at", since.toISOString())
      .order("aigc_score", { ascending: false })
      .limit(20);
    if (!isSuper && collegeId) aq = aq.eq("college_id", collegeId);
    const { data: apps } = await aq;
    const ids = Array.from(new Set((apps ?? []).map((a: any) => a.student_id)));
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("user_id, full_name, student_no").in("user_id", ids)
      : { data: [] as any[] };
    const pmap = new Map<string, any>();
    (profs ?? []).forEach((p: any) => pmap.set(p.user_id, p));
    const STATUS_CN: Record<string, string> = {
      fake: "高风险", suspect: "嫌疑", real: "通过",
      pending: "待检测", skipped: "跳过", error: "检测失败",
    };
    const fmtTime = (iso: string) => {
      const d = new Date(iso);
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const items = (apps ?? []).map((a: any) => ({
      姓名: pmap.get(a.student_id)?.full_name ?? "—",
      学号: pmap.get(a.student_id)?.student_no ?? "—",
      状态: STATUS_CN[a.aigc_status] ?? a.aigc_status,
      "AI生成概率": typeof a.aigc_score === "number" ? `${(a.aigc_score * 100).toFixed(1)}%` : "—",
      提交时间: fmtTime(a.submitted_at),
      申请编号末8位: String(a.id).slice(-8),
      申请描述: (a.description || "").slice(0, 60),
    }));
    const 范围中文 = range === "month" ? "近 30 天" : "本周";
    return { 范围: 范围中文, 条数: items.length, 明细: items };
  }

  if (name === "student_full_profile") {
    const q = String(args?.query || "").trim();
    if (!q) return { found: false, reason: "查询关键词为空" };
    let pq = supabase
      .from("profiles")
      .select("user_id, full_name, student_no, department, class_name, major, phone, email, id_card, gender, birth_date, enrollment_year, political_status, address, emergency_contact, emergency_phone, college_id")
      .or(`student_no.eq.${q},full_name.eq.${q},student_no.ilike.%${q}%,full_name.ilike.%${q}%`)
      .limit(5);
    if (!isSuper && collegeId) pq = pq.eq("college_id", collegeId);
    const { data: profiles } = await pq;
    if (!profiles || profiles.length === 0) return { found: false, reason: "数据库中未找到该学生" };
    // Prefer exact student_no/full_name match
    const p: any = profiles.find((x: any) => x.student_no === q || x.full_name === q) || profiles[0];
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", p.user_id).eq("role", "student");
    if (!roles || roles.length === 0) return { found: false, reason: "匹配到的用户不是学生" };
    const { data: apps } = await supabase
      .from("applications")
      .select("status, final_credit, ai_suggested_credit");
    let total_credit = 0;
    let app_count = 0;
    (apps || []).forEach((a: any) => {
      // We need student-scoped; refetch with filter
    });
    const { data: myApps } = await supabase
      .from("applications")
      .select("status, final_credit, ai_suggested_credit")
      .eq("student_id", p.user_id);
    (myApps || []).forEach((a: any) => {
      app_count++;
      if (["approved", "auto_approved"].includes(a.status)) {
        total_credit += Number(a.final_credit ?? a.ai_suggested_credit ?? 0);
      }
    });
    return {
      found: true,
      profile: p,
      total_credit,
      application_count: app_count,
      ambiguous_count: profiles.length > 1 ? profiles.length : 0,
    };
  }

  if (name === "student_submission_history") {
    const q = String(args?.query || "").trim();
    const limit = Math.min(Number(args?.limit ?? 10), 30);
    if (!q) return { records: [], reason: "查询关键词为空" };
    let pq2 = supabase
      .from("profiles")
      .select("user_id, student_no, full_name, college_id")
      .or(`student_no.eq.${q},full_name.eq.${q},student_no.ilike.%${q}%,full_name.ilike.%${q}%`)
      .limit(1);
    if (!isSuper && collegeId) pq2 = pq2.eq("college_id", collegeId);
    const { data: profiles } = await pq2;
    if (!profiles || profiles.length === 0) return { records: [], reason: "数据库中未找到该学生" };
    const sid = (profiles[0] as any).user_id;
    const { data: rows } = await supabase
      .from("submission_summary")
      .select("application_id, status, description, submitted_at, ai_confidence, ai_suggested_credit, ai_reasoning, final_credit, reviewer_name, final_review_note, reviewed_at")
      .eq("student_id", sid)
      .order("submitted_at", { ascending: false })
      .limit(limit);
    return {
      student: profiles[0],
      count: rows?.length ?? 0,
      records: rows || [],
    };
  }

  if (name === "submission_timeline") {
    const aid = String(args?.application_id || "").trim();
    if (!aid) return { events: [], reason: "application_id 为空" };
    const { data: rows } = await supabase
      .from("submission_records")
      .select("event_type, ai_decision, ai_confidence, ai_suggested_credit, ai_reasoning, review_decision, review_credit, review_note, status_snapshot, created_at, actor_id")
      .eq("application_id", aid)
      .order("created_at", { ascending: true });
    return { application_id: aid, count: rows?.length ?? 0, events: rows || [] };
  }

  if (name === "certificate_type_lookup") {
    const k = String(args?.keyword || "").trim();
    if (!k) return { matches: [], reason: "关键词为空" };
    const { data: rows } = await supabase
      .from("certificate_types")
      .select("name, category, level, identity, typical_credit, occurrence_count, source_rule_ids, source_case_ids, keywords")
      .or(`name.ilike.%${k}%,category.ilike.%${k}%,level.ilike.%${k}%`)
      .limit(15);
    return {
      keyword: k,
      count: rows?.length ?? 0,
      matches: (rows || []).map((r: any) => ({
        name: r.name,
        category: r.category,
        level: r.level,
        identity: r.identity,
        typical_credit: r.typical_credit,
        linked_rule_count: (r.source_rule_ids || []).length,
        linked_case_count: (r.source_case_ids || []).length,
        keywords: r.keywords,
      })),
    };
  }

  if (name === "account_provenance") {
    const q = String(args?.query || "").trim();
    if (!q) return { matches: [], note: "查询关键词为空" };

    // 1) 找到候选 profile（精确学号 / 精确姓名 / 模糊姓名）
    let pq3 = supabase
      .from("profiles")
      .select("user_id, full_name, student_no, department, class_name, major, college_id")
      .or(`student_no.eq.${q},full_name.eq.${q},student_no.ilike.%${q}%,full_name.ilike.%${q}%`)
      .limit(20);
    if (!isSuper && collegeId) pq3 = pq3.eq("college_id", collegeId);
    const { data: profs } = await pq3;
    if (!profs || profs.length === 0) {
      return { matches: [], note: "数据库中没有匹配的账号" };
    }

    const userIds: string[] = profs.map((p: any) => p.user_id).filter(Boolean);
    const studentNos: string[] = profs.map((p: any) => p.student_no).filter(Boolean);

    // 2) 在 audit_logs 中按 user_id 或 student_no 查找 import_users 事件
    const logMap = new Map<string, any>(); // dedupe by audit_log id
    const collectLogs = async (col: "target_ids" | "target_labels", arr: string[]) => {
      if (!arr.length) return;
      const { data } = await supabase
        .from("audit_logs")
        .select("id, action, actor_id, actor_email, target_ids, target_labels, metadata, created_at")
        .eq("action", "import_users")
        .overlaps(col, arr)
        .order("created_at", { ascending: true })
        .limit(100);
      (data || []).forEach((row: any) => logMap.set(row.id, row));
    };
    await collectLogs("target_ids", userIds);
    await collectLogs("target_labels", studentNos);

    const fmtCn = (iso: string) => {
      try {
        return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
      } catch { return iso; }
    };

    // 3) 把 audit log 反向映射到具体的 profile
    const matches: any[] = [];
    for (const p of profs as any[]) {
      const hits = Array.from(logMap.values()).filter((log: any) => {
        const ids: string[] = log.target_ids || [];
        const labels: string[] = log.target_labels || [];
        return (p.user_id && ids.includes(p.user_id))
          || (p.student_no && labels.includes(p.student_no));
      });
      if (hits.length === 0) {
        matches.push({
          full_name: p.full_name,
          student_no: p.student_no,
          department: p.department,
          class_name: p.class_name,
          imported: false,
          note: "audit_logs 中未找到该账号的导入事件",
        });
      } else {
        for (const log of hits) {
          matches.push({
            full_name: p.full_name,
            student_no: p.student_no,
            department: p.department,
            class_name: p.class_name,
            imported: true,
            imported_at: log.created_at,
            imported_at_cn: fmtCn(log.created_at),
            imported_by_email: log.actor_email || null,
            imported_by_id: log.actor_id || null,
            file_name: log?.metadata?.file_name ?? null,
            audit_log_id: log.id,
          });
        }
      }
    }

    const truncated = matches.length > 20;
    return {
      query: q,
      candidate_count: profs.length,
      matches: truncated ? matches.slice(0, 20) : matches,
      truncated,
    };
  }

  return { error: `unknown tool: ${name}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as { messages: Msg[]; role?: string };
    const messages = body.messages || [];
    const userRole = body.role || "teacher";

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages 不能为空" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- 强制校验调用者身份：必须是 teacher/admin/super_admin ----
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let identityBlock = "";
    let uid: string | undefined;
    {
      const token = authHeader.slice(7);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: userData, error: claimErr } = await userClient.auth.getUser(token);
      uid = userData?.user?.id as string | undefined;
      if (claimErr || !uid) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: callerRoles } = await supabase
        .from("user_roles").select("role").eq("user_id", uid)
        .in("role", ["teacher", "admin", "super_admin"]);
      if (!callerRoles || callerRoles.length === 0) {
        return new Response(JSON.stringify({ error: "Forbidden: staff only" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        if (uid) {
          const [{ data: prof }, { data: ur }] = await Promise.all([
            supabase.from("profiles").select("full_name,email,department,class_name,major,student_no,college_id").eq("user_id", uid).maybeSingle(),
            supabase.from("user_roles").select("role,college_id").eq("user_id", uid),
          ]);
          const roles = (ur || []).map((r: any) => r.role);
          const collegeIds = Array.from(new Set((ur || []).map((r: any) => r.college_id).filter(Boolean)));
          const cid = (prof as any)?.college_id || collegeIds[0];
          let collegeName = "（未绑定学院）";
          if (cid) {
            const { data: col } = await supabase.from("colleges").select("name,short_name").eq("id", cid).maybeSingle();
            if (col) collegeName = (col as any).short_name || (col as any).name || collegeName;
          }
          const roleZh = roles.includes("super_admin") ? "超级管理员"
            : roles.includes("admin") ? "学院管理员"
            : roles.includes("teacher") ? "教师"
            : roles.includes("student") ? "学生" : "未知角色";
          const isSuper = roles.includes("super_admin");
          identityBlock = `===== 当前登录用户 =====\n姓名：${(prof as any)?.full_name ?? "-"}\n邮箱：${(prof as any)?.email ?? "-"}\n角色：${roleZh}${isSuper ? "（可访问全校所有学院数据）" : ""}\n所属学院：${isSuper ? "全校" : collegeName}\n部门/学院：${(prof as any)?.department ?? "-"}\n${(prof as any)?.student_no ? `学号：${(prof as any).student_no}\n` : ""}全部角色：${roles.join("、") || "-"}`;
        }
      } catch (_) { /* ignore */ }
    }

    const aiCfg = await getAiConfig("staff-ai-assistant");
    const endpoint = `${aiCfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const apiKey = aiCfg.apiKey;
    const model = aiCfg.model;
    const provider = aiCfg.vendor;

    const sysMsg: Msg = { role: "system", content: `${SYSTEM_PROMPT}${IDENTITY_RULE}${PROVENANCE_RULE}${AIGC_RULE}${CHINESE_ONLY_RULE}${NO_PATH_RULE}${FORMAT_GUIDE}\n\n当前用户角色：${userRole}` };
    const convo: Msg[] = [sysMsg];
    if (identityBlock) convo.push({ role: "system", content: identityBlock });
    convo.push(...messages.slice(-12));

    let action: any = null;
    let candidates: any[] | null = null;
    let stats: any = null;
    let toolCallCount = 0;

    // Up to 3 tool-call rounds
    for (let round = 0; round < 3; round++) {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: convo,
          temperature: 0.2,
          tools: TOOLS,
          tool_choice: "auto",
          stream: false,
        }),
      });

      if (!resp.ok) {
        const t = await resp.text();
        console.error(`AI provider (${provider}) error:`, resp.status, t);
        if (resp.status === 429) return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (resp.status === 401 || resp.status === 402) return new Response(JSON.stringify({ error: "AI 服务认证失败或额度不足，请联系管理员" }), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: "AI 服务暂时不可用" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const data = await resp.json();
      const choice = data?.choices?.[0];
      const message = choice?.message;
      const toolCalls = message?.tool_calls;

      if (toolCalls && toolCalls.length > 0) {
        toolCallCount += toolCalls.length;
        convo.push({ role: "assistant", content: message.content || "", tool_calls: toolCalls });
        for (const tc of toolCalls) {
          let args: any = {};
          try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { args = {}; }
          const result = await execTool(tc.function?.name, args, supabase, userRole);

          if (tc.function?.name === "navigate_to" && (result as any).path) {
            action = { type: "navigate", payload: { path: (result as any).path } };
          }
          if (tc.function?.name === "find_student") {
            candidates = (result as any).candidates || [];
          }
          if (tc.function?.name === "list_failing_students") {
            stats = result;
            action = { type: "navigate", payload: { path: (result as any).navigate_path } };
          }
          if (tc.function?.name === "query_stats") {
            stats = result;
            if ((result as any).navigate_path) {
              action = { type: "navigate", payload: { path: (result as any).navigate_path } };
            }
          }

          convo.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function?.name,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      let answer = (message?.content || "").trim() || "好的。";
      let polished = false;
      if (shouldPolish(answer, { toolCalls: toolCallCount })) {
        const r = await callPolish(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          answer,
        );
        if (r.polished) { answer = r.text; polished = true; }
      }
      const cleaned = stripPathsFromAnswer(normalizeMarkdown(answer));
      return new Response(JSON.stringify({
        answer: cleaned,
        sections: toSections(cleaned),
        meta: { polished },
        action, candidates, stats,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fallback = normalizeMarkdown("已完成多轮工具调用，请查看结果。");
    return new Response(JSON.stringify({
      answer: fallback, sections: toSections(fallback), meta: { polished: false },
      action, candidates, stats,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("staff-ai-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "未知错误" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});