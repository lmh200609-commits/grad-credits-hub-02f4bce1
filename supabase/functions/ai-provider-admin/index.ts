import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getCallerUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data, error } = await userClient.auth.getUser(token);
    if (error) {
      console.error("getUser error:", error.message);
      return null;
    }
    return data?.user?.id ?? null;
  } catch (e) {
    console.error("auth exception:", e);
    return null;
  }
}

async function ensureAdmin(req: Request): Promise<{ ok: true; uid: string } | { ok: false; resp: Response }> {
  const uid = await getCallerUserId(req);
  if (!uid) return { ok: false, resp: json({ error: "未登录" }, 401) };
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", uid);
  if (!(roles ?? []).some((r) => r.role === "super_admin")) {
    return { ok: false, resp: json({ error: "Forbidden: super_admin only" }, 403) };
  }
  return { ok: true, uid };
}

const VENDOR_FALLBACK_URL: Record<string, string> = {
  deepseek: "https://api.deepseek.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  kimi: "https://api.moonshot.cn/v1",
  wenxin: "https://qianfan.baidubce.com/v2",
  custom: "",
};

async function pingProvider(baseUrl: string, apiKey: string, model: string): Promise<{ ok: boolean; status?: number; latency_ms: number; error?: string; sample?: string }> {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const t0 = performance.now();
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
        temperature: 0,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    const latency = Math.round(performance.now() - t0);
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 300);
      return { ok: false, status: resp.status, latency_ms: latency, error: text };
    }
    const data = await resp.json().catch(() => ({}));
    const sample = data?.choices?.[0]?.message?.content?.toString().slice(0, 60) ?? "";
    return { ok: true, status: resp.status, latency_ms: latency, sample };
  } catch (e) {
    clearTimeout(tid);
    return { ok: false, latency_ms: Math.round(performance.now() - t0), error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const guard = await ensureAdmin(req);
  if (!guard.ok) return guard.resp;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const SECRET = Deno.env.get("AI_KEY_ENCRYPTION_SECRET");
  if (!SECRET) return json({ error: "服务器缺少 AI_KEY_ENCRYPTION_SECRET 配置" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body.action || "");

  try {
    if (action === "list_providers") {
      const { data, error } = await admin
        .from("ai_providers")
        .select("id, name, vendor, base_url, api_key_last4, note, created_at, updated_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return json({ providers: data ?? [] });
    }

    if (action === "upsert_provider") {
      const { id, name, vendor, base_url, api_key, note } = body;
      if (!name || !vendor || !base_url) return json({ error: "name / vendor / base_url 必填" }, 400);
      const cleanBase = String(base_url).trim().replace(/\/+$/, "");

      let api_key_encrypted: string | null = null;
      let api_key_last4: string | null = null;
      if (api_key && String(api_key).length > 0) {
        const { data: enc, error: encErr } = await admin.rpc("ai_encrypt_api_key", {
          _plain: String(api_key),
          _secret: SECRET,
        });
        if (encErr) throw encErr;
        const row = Array.isArray(enc) ? enc[0] : enc;
        api_key_encrypted = row?.encrypted ?? null;
        api_key_last4 = row?.last4 ?? null;
      }

      if (id) {
        const patch: any = { name, vendor, base_url: cleanBase, note: note ?? null };
        if (api_key_encrypted) {
          patch.api_key_encrypted = api_key_encrypted;
          patch.api_key_last4 = api_key_last4;
        }
        const { data, error } = await admin
          .from("ai_providers")
          .update(patch)
          .eq("id", id)
          .select("id, name, vendor, base_url, api_key_last4, note")
          .maybeSingle();
        if (error) throw error;
        return json({ provider: data });
      } else {
        if (!api_key_encrypted) return json({ error: "新增提供商时必须填写 API Key" }, 400);
        const { data, error } = await admin
          .from("ai_providers")
          .insert({
            name, vendor, base_url: cleanBase, note: note ?? null,
            api_key_encrypted, api_key_last4: api_key_last4 ?? "",
            created_by: guard.uid,
          })
          .select("id, name, vendor, base_url, api_key_last4, note")
          .maybeSingle();
        if (error) throw error;
        return json({ provider: data });
      }
    }

    if (action === "delete_provider") {
      const { id } = body;
      if (!id) return json({ error: "id 必填" }, 400);
      const { error } = await admin.from("ai_providers").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "test_provider") {
      const { provider_id, base_url, api_key, model } = body;
      let useUrl = base_url ? String(base_url).trim() : "";
      let useKey = api_key ? String(api_key) : "";
      const useModel = model || "deepseek-chat";
      if (provider_id) {
        const { data: prov, error } = await admin
          .from("ai_providers").select("base_url").eq("id", provider_id).maybeSingle();
        if (error) throw error;
        if (!prov) return json({ error: "provider not found" }, 404);
        useUrl = useUrl || (prov.base_url as string);
        if (!useKey) {
          const { data: dec, error: decErr } = await admin.rpc("ai_decrypt_provider_key", {
            _provider_id: provider_id, _secret: SECRET,
          });
          if (decErr) throw decErr;
          useKey = (dec as string) ?? "";
        }
      }
      if (!useUrl || !useKey) return json({ error: "base_url 与 api_key 都必须提供" }, 400);
      const result = await pingProvider(useUrl, useKey, useModel);
      return json(result);
    }

    if (action === "list_bindings") {
      const { data, error } = await admin
        .from("ai_function_bindings")
        .select("function_key, model, provider_id, ai_providers(id, name, vendor, base_url, api_key_last4)")
        .order("function_key");
      if (error) throw error;

      // Compute environment fallback so the admin can see what is *actually* called
      // for any function that hasn't been explicitly bound to a provider.
      const dashscope = !!Deno.env.get("DASHSCOPE_API_KEY");
      const deepseek = !!Deno.env.get("DEEPSEEK_API_KEY");
      let fallback: { vendor: string; baseUrl: string; providerName: string; defaultModel: string; envKey: string } | null = null;
      if (dashscope) {
        fallback = { vendor: "qwen", baseUrl: VENDOR_FALLBACK_URL.qwen, providerName: "通义千问 （环境变量）", defaultModel: "qwen-plus", envKey: "DASHSCOPE_API_KEY" };
      } else if (deepseek) {
        fallback = { vendor: "deepseek", baseUrl: VENDOR_FALLBACK_URL.deepseek, providerName: "DeepSeek （环境变量）", defaultModel: "deepseek-chat", envKey: "DEEPSEEK_API_KEY" };
      }

      // Make sure every known function appears, even when no DB row exists yet.
      const KNOWN_FUNCTIONS = [
        "evaluate-application",
        "ai-parse-roster",
        "ai-explain-import",
        "import-assistant-chat",
        "staff-ai-assistant",
        "ask-credit-assistant",
        "polish-answer",
      ];
      const map = new Map<string, any>();
      for (const row of data ?? []) map.set((row as any).function_key, row);
      const merged = KNOWN_FUNCTIONS.map((fk) => {
        const row = map.get(fk);
        if (row) return row;
        return { function_key: fk, model: fallback?.defaultModel ?? "", provider_id: null, ai_providers: null };
      });

      return json({ bindings: merged, fallback });
    }

    if (action === "upsert_binding") {
      const { function_key, provider_id, model } = body;
      if (!function_key || !model) return json({ error: "function_key 与 model 必填" }, 400);
      const { data, error } = await admin
        .from("ai_function_bindings")
        .upsert({
          function_key,
          provider_id: provider_id ?? null,
          model,
          updated_at: new Date().toISOString(),
          updated_by: guard.uid,
        }, { onConflict: "function_key" })
        .select()
        .maybeSingle();
      if (error) throw error;
      return json({ binding: data });
    }

    if (action === "vendor_presets") {
      return json({
        presets: Object.entries(VENDOR_FALLBACK_URL).map(([vendor, baseUrl]) => ({ vendor, baseUrl })),
      });
    }

    if (action === "restore_defaults") {
      // Create (or reuse) DashScope + DeepSeek providers from env vars,
      // then bind every function to its previously-recorded model.
      const dashKey = Deno.env.get("DASHSCOPE_API_KEY") || "";
      const dsKey = Deno.env.get("DEEPSEEK_API_KEY") || "";

      const ensureProvider = async (
        name: string, vendor: string, baseUrl: string, plainKey: string,
      ): Promise<string | null> => {
        if (!plainKey) return null;
        const { data: existing } = await admin
          .from("ai_providers").select("id").eq("vendor", vendor).eq("name", name).maybeSingle();
        const { data: enc, error: encErr } = await admin.rpc("ai_encrypt_api_key", {
          _plain: plainKey, _secret: SECRET,
        });
        if (encErr) throw encErr;
        const row = Array.isArray(enc) ? enc[0] : enc;
        const api_key_encrypted = row?.encrypted as string;
        const api_key_last4 = row?.last4 as string;
        if (existing?.id) {
          await admin.from("ai_providers").update({
            base_url: baseUrl, api_key_encrypted, api_key_last4,
          }).eq("id", existing.id);
          return existing.id as string;
        }
        const { data: ins, error: insErr } = await admin.from("ai_providers").insert({
          name, vendor, base_url: baseUrl, note: "auto-restored from env",
          api_key_encrypted, api_key_last4: api_key_last4 ?? "",
          created_by: guard.uid,
        }).select("id").maybeSingle();
        if (insErr) throw insErr;
        return (ins?.id as string) ?? null;
      };

      const qwenId = await ensureProvider(
        "通义千问 DashScope", "qwen", VENDOR_FALLBACK_URL.qwen, dashKey,
      );
      const deepseekId = await ensureProvider(
        "DeepSeek 深度求索", "deepseek", VENDOR_FALLBACK_URL.deepseek, dsKey,
      );

      const PLAN: { fk: string; provider: "qwen" | "deepseek"; model: string }[] = [
        { fk: "evaluate-application",   provider: "qwen",     model: "qwen3-vl-32b-thinking" },
        { fk: "ai-parse-roster",        provider: "qwen",     model: "qwen-plus" },
        { fk: "ai-explain-import",      provider: "qwen",     model: "qwen-turbo" },
        { fk: "import-assistant-chat",  provider: "qwen",     model: "qwen-turbo" },
        { fk: "staff-ai-assistant",     provider: "deepseek", model: "deepseek-chat" },
        { fk: "ask-credit-assistant",   provider: "deepseek", model: "deepseek-chat" },
        { fk: "polish-answer",          provider: "deepseek", model: "deepseek-chat" },
      ];
      const results: any[] = [];
      for (const p of PLAN) {
        const pid = p.provider === "qwen" ? qwenId : deepseekId;
        if (!pid) {
          results.push({ function_key: p.fk, ok: false, error: `${p.provider} key 未配置` });
          continue;
        }
        const { error } = await admin.from("ai_function_bindings").upsert({
          function_key: p.fk,
          provider_id: pid,
          model: p.model,
          updated_at: new Date().toISOString(),
          updated_by: guard.uid,
        }, { onConflict: "function_key" });
        results.push({ function_key: p.fk, ok: !error, model: p.model, vendor: p.provider, error: error?.message });
      }
      return json({ ok: true, qwenId, deepseekId, results });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("ai-provider-admin error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});