import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-notify-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:dono@barbearia.local";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const notifySecret = Deno.env.get("NOTIFY_SECRET");

    const body = await req.json();
    const agendamentoId = body?.agendamento_id as string | undefined;
    const manageToken = body?.manage_token as string | undefined;
    const headerSecret = req.headers.get("x-notify-secret");

    if (!agendamentoId) {
      return json({ error: "agendamento_id obrigatório" }, 400);
    }

    // Autorização: manage_token (fluxo público) OU secret interno
    const authorizedBySecret =
      Boolean(notifySecret) && headerSecret === notifySecret && notifySecret.length >= 16;
    if (!authorizedBySecret && !manageToken) {
      return json({ error: "não autorizado" }, 401);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // One-shot claim (com token) ou claim direto via service se secret
    if (manageToken) {
      const { data: claim, error: claimErr } = await admin.rpc("claim_push_notification", {
        p_agendamento_id: agendamentoId,
        p_token: manageToken,
      });
      if (claimErr) {
        return json({ error: "claim_falhou", detail: claimErr.message }, 403);
      }
      if (!(claim as { ok?: boolean })?.ok) {
        return json({ ok: false, reason: (claim as { reason?: string })?.reason || "denied" }, 200);
      }
    } else {
      const { data: claimed, error } = await admin
        .from("agendamentos")
        .update({ push_enviado_em: new Date().toISOString() })
        .eq("id", agendamentoId)
        .is("push_enviado_em", null)
        .eq("origem", "pagina")
        .select("id")
        .maybeSingle();
      if (error || !claimed) {
        return json({ ok: false, reason: "already_sent_or_missing" }, 200);
      }
    }

    if (!vapidPublic || !vapidPrivate) {
      return json({ ok: true, sent: 0, reason: "vapid_not_configured" }, 200);
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const { data: ag, error } = await admin
      .from("agendamentos")
      .select("id, barbeiro_id, inicio, cliente:clientes(nome)")
      .eq("id", agendamentoId)
      .maybeSingle();

    if (error || !ag) {
      return json({ error: "não encontrado" }, 404);
    }

    const { data: users } = await admin
      .from("usuarios")
      .select("id, papel, barbeiro_id")
      .eq("ativo", true);

    const targets = (users || []).filter(
      (u) => u.papel === "dono" || u.barbeiro_id === ag.barbeiro_id,
    );
    const ids = targets.map((u) => u.id);
    if (!ids.length) return json({ ok: true, sent: 0 });

    const { data: devices } = await admin
      .from("dispositivos_push")
      .select("*")
      .in("usuario_id", ids);

    const clienteNome = Array.isArray(ag.cliente)
      ? ag.cliente[0]?.nome
      : (ag.cliente as { nome?: string } | null)?.nome;

    const inicioSp = new Date(ag.inicio).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });

    const payload = JSON.stringify({
      title: "Novo agendamento",
      body: `${clienteNome || "Cliente"} — ${inicioSp}`,
      url: "/painel/agenda",
    });

    let sent = 0;
    for (const d of devices || []) {
      try {
        await webpush.sendNotification(
          {
            endpoint: d.endpoint,
            keys: { p256dh: d.p256dh, auth: d.auth },
          },
          payload,
        );
        sent++;
      } catch (e) {
        console.error("push fail", e);
      }
    }

    return json({ ok: true, sent });
  } catch (e) {
    console.error(e);
    return json({ error: "falha interna" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
