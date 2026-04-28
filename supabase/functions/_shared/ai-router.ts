// Shared AI router: reads function->provider binding from DB, decrypts API key,
// and exposes a unified OpenAI-compatible chat call.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type AiConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  vendor: string;
  providerName: string;
};

// Vendor → fallback hard-coded endpoint when no DB binding exists.
const VENDOR_FALLBACK_URL: Record<string, string> = {
  deepseek: "https://api.deepseek.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  kimi: "https://api.moonshot.cn/v1",
  wenxin: "https://qianfan.baidubce.com/v2",
  custom: "",
};

function getAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * Decrypt an api_key_encrypted value via pgp_sym_decrypt.
 * Uses a tiny RPC-free path: a transient SELECT through the service role.
 */
async function decryptKey(admin: ReturnType<typeof getAdmin>, providerId: string): Promise<string | null> {
  const secret = Deno.env.get("AI_KEY_ENCRYPTION_SECRET");
  if (!secret) return null;
  // Use rpc-style raw SQL via the postgres-meta function. We avoid arbitrary SQL by
  // calling a dedicated SECURITY DEFINER function we create below.
  const { data, error } = await admin.rpc("ai_decrypt_provider_key", {
    _provider_id: providerId,
    _secret: secret,
  });
  if (error) {
    console.error("ai_decrypt_provider_key error:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/**
 * Resolve the AI configuration for a function key.
 * Falls back to env-var based DEEPSEEK / DASHSCOPE keys for backward compat.
 */
export async function getAiConfig(functionKey: string): Promise<AiConfig> {
  const admin = getAdmin();
  const { data: binding } = await admin
    .from("ai_function_bindings")
    .select("model, provider_id, ai_providers(id, name, vendor, base_url)")
    .eq("function_key", functionKey)
    .maybeSingle();

  const providerRow: any = (binding as any)?.ai_providers ?? null;
  if (binding && providerRow) {
    const apiKey = await decryptKey(admin, providerRow.id);
    if (apiKey) {
      const baseUrl = (providerRow.base_url as string).replace(/\/+$/, "");
      return {
        baseUrl,
        apiKey,
        model: (binding as any).model || "deepseek-chat",
        vendor: providerRow.vendor,
        providerName: providerRow.name,
      };
    }
  }

  // Fallback to env vars (legacy behavior) so the system never silently breaks.
  const dashscope = Deno.env.get("DASHSCOPE_API_KEY");
  const deepseek = Deno.env.get("DEEPSEEK_API_KEY");
  const preferQwen = !!dashscope;
  const bindingModel = (binding as any)?.model as string | undefined;
  const isQwenModel = (m?: string) => !!m && /^(qwen|qwq|qvq)/i.test(m);
  const isDeepseekModel = (m?: string) => !!m && /^deepseek/i.test(m);
  if (preferQwen) {
    return {
      baseUrl: VENDOR_FALLBACK_URL.qwen,
      apiKey: dashscope!,
      // Only honor the binding model if it's actually a Qwen model;
      // otherwise the request would 404 on DashScope.
      model: isQwenModel(bindingModel) ? bindingModel! : "qwen-plus",
      vendor: "qwen",
      providerName: "通义千问 (env fallback)",
    };
  }
  if (deepseek) {
    return {
      baseUrl: VENDOR_FALLBACK_URL.deepseek,
      apiKey: deepseek,
      model: isDeepseekModel(bindingModel) ? bindingModel! : "deepseek-chat",
      vendor: "deepseek",
      providerName: "DeepSeek (env fallback)",
    };
  }
  throw new Error(`AI 模型未配置：请到管理员端"AI 模型设置"为功能 ${functionKey} 绑定提供商`);
}

/** Build the chat-completions URL for an AiConfig. */
export function chatCompletionsUrl(cfg: AiConfig): string {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

/**
 * Unified chat call. Returns the raw fetch Response so callers can stream / parse
 * tool_calls themselves. Body must already be a valid OpenAI-compatible payload
 * (without `model` — we inject the model from cfg).
 */
export async function callChatCompletions(
  cfg: AiConfig,
  body: Record<string, unknown>,
  opts: { signal?: AbortSignal } = {},
): Promise<Response> {
  return await fetch(chatCompletionsUrl(cfg), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: cfg.model, ...body }),
    signal: opts.signal,
  });
}

export const VENDOR_PRESETS: { vendor: string; label: string; baseUrl: string; sampleModels: string[] }[] = [
  { vendor: "deepseek", label: "DeepSeek 深度求索", baseUrl: "https://api.deepseek.com/v1", sampleModels: ["deepseek-chat", "deepseek-reasoner"] },
  { vendor: "qwen", label: "阿里通义千问 DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", sampleModels: ["qwen-plus", "qwen-turbo", "qwen3-vl-32b-thinking"] },
  { vendor: "zhipu", label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", sampleModels: ["glm-4-plus", "glm-4-flash"] },
  { vendor: "kimi", label: "月之暗面 Kimi", baseUrl: "https://api.moonshot.cn/v1", sampleModels: ["moonshot-v1-8k", "moonshot-v1-32k"] },
  { vendor: "wenxin", label: "百度文心 千帆", baseUrl: "https://qianfan.baidubce.com/v2", sampleModels: ["ernie-4.5-turbo-128k"] },
  { vendor: "custom", label: "自定义 OpenAI 兼容", baseUrl: "", sampleModels: [] },
];