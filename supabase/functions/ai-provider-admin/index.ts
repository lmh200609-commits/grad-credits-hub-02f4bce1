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
    const { data } = await userClient.auth.getClaims(token);
    return (data?.claims?.sub as string | undefined) ?? null;
  } catch {
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
  if (!(roles ?? []).some((r) => r.role === "admin")) {
    return { ok: false, resp: json({ error: "Forbidden: admin only" }, 403) };
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
      return json({ bindings: data ?? [] });
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

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("ai-provider-admin error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});