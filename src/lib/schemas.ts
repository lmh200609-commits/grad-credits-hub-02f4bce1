import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("邮箱格式不正确").max(255),
  password: z.string().min(6, "密码至少 6 位").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const applySchema = z.object({
  description: z
    .string()
    .trim()
    .min(10, "请填写至少 10 字的申请说明")
    .max(2000, "说明不超过 2000 字"),
  selected_keywords: z.array(z.string()).default([]),
});
export type ApplyInput = z.infer<typeof applySchema>;

export const ruleSchema = z.object({
  name: z.string().trim().min(1, "请填写规则名称").max(100),
  category: z.string().trim().max(50).optional().or(z.literal("")),
  keywords: z.string().max(500).optional().or(z.literal("")),
  credit: z.coerce.number().min(0, "学分需 ≥ 0").max(20, "学分不超过 20"),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  active: z.boolean().default(true),
});
export type RuleInput = z.infer<typeof ruleSchema>;

export const caseSchema = z.object({
  title: z.string().trim().min(1, "标题必填").max(200),
  summary: z.string().trim().min(1, "摘要必填").max(2000),
  rule_id: z.string().default("none"),
  awarded_credit: z.coerce.number().min(0).max(20),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type CaseInput = z.infer<typeof caseSchema>;

export const projectSchema = z.object({
  name: z.string().trim().min(1, "项目名称必填").max(150),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  rule_ids: z.array(z.string()).default([]),
  ends_at: z.string().optional().or(z.literal("")),
  active: z.boolean().default(true),
});
export type ProjectInput = z.infer<typeof projectSchema>;

export const resetPasswordSchema = z.object({
  password: z
    .string()
    .min(8, "密码至少 8 位")
    .max(128)
    .regex(/[A-Za-z]/, "需包含字母")
    .regex(/[0-9]/, "需包含数字"),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
