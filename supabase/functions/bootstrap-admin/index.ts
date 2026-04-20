// One-off bootstrap function: create the first admin account.
// Safe to call only when no admin exists yet.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email, password, full_name } = await req.json();
    if (!email || !password) {
      return new Response(JSON.stringify({ error: "email and password required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Refuse if any admin already exists
    const { data: existing, error: existErr } = await admin
      .from("user_roles")
      .select("id")
      .eq("role", "admin")
      .limit(1);
    if (existErr) throw existErr;
    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ error: "Admin already exists. Use admin panel to add more." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create auth user (email confirmed)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? "系统管理员" },
    });
    if (createErr) throw createErr;
    const userId = created.user!.id;

    // Assign admin role
    const { error: roleErr } = await admin.from("user_roles").insert({ user_id: userId, role: "admin" });
    if (roleErr) throw roleErr;

    return new Response(JSON.stringify({ success: true, user_id: userId, email }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
