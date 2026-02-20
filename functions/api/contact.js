export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": env.SITE_ORIGIN,
    "Content-Type": "application/json",
  };

  const formData = await request.formData();
  const data = Object.fromEntries(formData.entries());

  // Anti-spam (honeypot)
  if (data.website && data.website !== "") {
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  if (!data.email || !data.message) {
    return new Response(JSON.stringify({ error: "Missing fields" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Helpers
  const escapeHtml = (str) =>
    String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const nl2br = (str) => escapeHtml(str).replace(/\n/g, "<br>");

  const isAutoDevis = String(data.message || "").includes("Type : Auto-devis");

  // 1) Email interne (ProcessXcel)
  const internalSubject = isAutoDevis
    ? `Nouvelle demande Auto-devis – ${data.name || "Prospect"}`
    : `Nouveau message site – ${data.name || "Contact"}`;

  const internalEmailPayload = {
    from: env.CONTACT_FROM,
    to: [env.CONTACT_TO],
    reply_to: data.email,
    subject: internalSubject,
    html: `
      <h2>${isAutoDevis ? "Nouvelle demande – Auto-devis" : "Nouveau message – Site ProcessXcel"}</h2>
      <p><strong>Nom :</strong> ${escapeHtml(data.name || "-")}</p>
      <p><strong>Email :</strong> ${escapeHtml(data.email)}</p>
      <p><strong>Téléphone :</strong> ${escapeHtml(data.phone || "-")}</p>
      <p><strong>Message :</strong><br>${nl2br(data.message)}</p>
    `,
  };

  const resInternal = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(internalEmailPayload),
  });

  if (!resInternal.ok) {
    return new Response(JSON.stringify({ error: "Email failed" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  // 2) Email de confirmation client
  // (Pour éviter de bloquer l'envoi interne si le mail client échoue, on renvoie ok:true même si la confirmation échoue.)
  const clientEmailPayload = {
    from: env.CONTACT_FROM,
    to: [data.email],
    reply_to: env.CONTACT_TO,
    subject: isAutoDevis
      ? "Votre estimation ProcessXcel – Bien reçu"
      : "Votre message ProcessXcel – Bien reçu",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#222">
        <h2 style="margin:0 0 8px;">Merci, nous avons bien reçu votre demande</h2>
        <p style="margin:0 0 10px;">
          Bonjour ${escapeHtml(data.name || "")}${data.name ? "," : ""}<br>
          ${isAutoDevis
            ? "Nous avons bien reçu votre demande d’estimation (auto-devis)."
            : "Nous avons bien reçu votre message."}
        </p>

        <p style="margin:0 0 14px;">
          Nous vous recontactons rapidement pour valider le besoin (et, si nécessaire, affiner l’estimation sur vos fichiers).
        </p>

        <div style="border:1px solid #eee;border-radius:12px;padding:12px;background:#fafafa;">
          <div style="font-size:13px;color:#555;margin-bottom:6px;"><strong>Récapitulatif</strong></div>
          <div style="font-size:14px;">${nl2br(data.message)}</div>
        </div>

        <p style="margin:14px 0 0;font-size:13px;color:#555;">
          À bientôt,<br>
          ProcessXcel<br>
          <a href="mailto:${escapeHtml(env.CONTACT_TO)}">${escapeHtml(env.CONTACT_TO)}</a>
        </p>
      </div>
    `,
  };

  // Ne pas faire échouer la requête si la confirmation client échoue
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(clientEmailPayload),
    });
  } catch (_) {}

  return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
}
