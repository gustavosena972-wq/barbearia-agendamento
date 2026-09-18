import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Secrets:
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET
 * CRON_SECRET (obrigatório para action=reminders)
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-hub-signature-256",
};

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verify = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    if (!verify) return new Response("verify_token_not_configured", { status: 500 });
    if (mode === "subscribe" && token === verify && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const rawBody = await req.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: "json inválido" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    // Cron autenticado
    if (body?.action === "reminders") {
      const cronSecret = Deno.env.get("CRON_SECRET");
      const provided = req.headers.get("x-cron-secret") || (body.cron_secret as string | undefined);
      if (!cronSecret || cronSecret.length < 24 || provided !== cronSecret) {
        return json({ error: "cron não autorizado" }, 401);
      }
      const { data, error } = await admin.rpc("disparar_lembretes");
      if (error) throw error;
      const { data: sem } = await admin.rpc("processar_sem_resposta");
      await flushWhatsAppOutbound(admin);
      return json({ ok: true, lembretes: data, sem_resposta: sem });
    }

    // Webhook Meta: exige assinatura se APP_SECRET estiver configurado
    const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
    if (appSecret) {
      const sig = req.headers.get("x-hub-signature-256");
      if (!sig || !(await verifyMetaSignature(appSecret, rawBody, sig))) {
        return json({ error: "assinatura inválida" }, 401);
      }
    } else {
      // Sem secret: rejeita inbound em produção (não confiar em body aberto)
      return json({ error: "WHATSAPP_APP_SECRET não configurado" }, 503);
    }

    const entry = (body as { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{
      from: string;
      text?: { body: string };
      type: string;
    }> } }> }> }).entry?.[0]?.changes?.[0]?.value;
    const messages = entry?.messages;

    if (!messages?.length) {
      return json({ ok: true, ignored: true });
    }

    for (const msg of messages) {
      if (msg.type !== "text" || !msg.text?.body) continue;
      const phone = normalizePhone(msg.from);
      const { data: cliente } = await admin
        .from("clientes")
        .select("id")
        .eq("telefone", phone)
        .maybeSingle();
      if (!cliente) continue;

      const { data: ag } = await admin
        .from("agendamentos")
        .select("id")
        .eq("cliente_id", cliente.id)
        .neq("status", "cancelado")
        .gte("inicio", new Date().toISOString())
        .order("inicio")
        .limit(1)
        .maybeSingle();

      if (!ag) continue;

      const { data: result } = await admin.rpc("processar_resposta_cliente", {
        p_agendamento_id: ag.id,
        p_texto: msg.text.body,
        p_canal: "whatsapp",
      });

      const reply = (result as { reply?: string } | null)?.reply;
      if (reply) await sendWhatsAppText(phone, reply);
    }

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "falha" }, 500);
  }
});

function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) return d.slice(2);
  return d;
}

async function verifyMetaSignature(appSecret: string, rawBody: string, header: string): Promise<boolean> {
  const expected = header.replace(/^sha256=/, "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== expected.length) return false;
  let ok = 0;
  for (let i = 0; i < hex.length; i++) ok |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return ok === 0;
}

async function sendWhatsAppText(toDigits: string, text: string) {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) return;
  const to = toDigits.startsWith("55") ? toDigits : `55${toDigits}`;
  await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text.slice(0, 4000) },
    }),
  });
}

async function flushWhatsAppOutbound(admin: ReturnType<typeof createClient>) {
  const { data: shop } = await admin.from("barbearia").select("canal_mensagens").limit(1).maybeSingle();
  if (shop?.canal_mensagens !== "whatsapp") return;

  const { data: pending } = await admin
    .from("mensagens")
    .select("id, texto, meta, clientes(telefone)")
    .eq("direcao", "enviada")
    .eq("canal", "whatsapp")
    .order("created_at")
    .limit(20);

  for (const m of pending || []) {
    if ((m.meta as { wa_sent?: boolean } | null)?.wa_sent) continue;
    const tel = Array.isArray(m.clientes)
      ? m.clientes[0]?.telefone
      : (m.clientes as { telefone?: string } | null)?.telefone;
    if (!tel) continue;
    await sendWhatsAppText(tel, m.texto);
    await admin
      .from("mensagens")
      .update({ meta: { ...((m.meta as object) || {}), wa_sent: true } })
      .eq("id", m.id);
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
