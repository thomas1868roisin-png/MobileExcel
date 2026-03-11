export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": env.SITE_ORIGIN,
    "Content-Type": "application/json",
  };

  const formData = await request.formData();

  const name = String(formData.get("name") || "");
  const email = String(formData.get("email") || "");
  const message = String(formData.get("message") || "");
  const website = String(formData.get("website") || "");

  const file = formData.get("piece_jointe");

  // Anti-spam (honeypot)
  if (website && website !== "") {
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  if (!email || !message) {
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

  const isAutoDevis = String(message || "").includes("Type : Auto-devis");

  // Validation PJ
  const allowedMimeTypes = [
    "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
    "image/jpeg",
  ];

  const allowedExtensions = [
    ".pdf",
    ".xls",
    ".xlsx",
    ".csv",
    ".doc",
    ".docx",
    ".png",
    ".jpg",
    ".jpeg",
  ];

  const hasAllowedExtension = (filename) => {
    const lower = String(filename || "").toLowerCase();
    return allowedExtensions.some((ext) => lower.endsWith(ext));
  };

  const arrayBufferToBase64 = (buffer) => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  };

  let attachments = [];
  let attachmentInfoHtml = "<p><strong>Pièce jointe :</strong> Aucune</p>";

  if (file && typeof file === "object" && "size" in file && file.size > 0) {
    const filename = file.name || "piece_jointe";
    const mimeType = file.type || "";
    const maxSize = 5 * 1024 * 1024; // 5 Mo

    if (file.size > maxSize) {
      return new Response(
        JSON.stringify({ error: "Fichier trop volumineux (5 Mo max)." }),
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (!allowedMimeTypes.includes(mimeType) && !hasAllowedExtension(filename)) {
      return new Response(
        JSON.stringify({ error: "Type de fichier non autorisé." }),
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const buffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);

    attachments.push({
      filename,
      content: base64,
    });

    attachmentInfoHtml = `
      <p><strong>Pièce jointe :</strong> ${escapeHtml(filename)}</p>
      <p><strong>Taille :</strong> ${(file.size / 1024 / 1024).toFixed(2)} Mo</p>
      <p><strong>Type :</strong> ${escapeHtml(mimeType || "inconnu")}</p>
    `;
  }

  // 1) Email interne (ProcessXcel)
  const internalSubject = isAutoDevis
    ? `Nouvelle demande Auto-devis – ${name || "Prospect"}`
    : `Nouveau message site – ${name || "Contact"}`;

  const internalEmailPayload = {
    from: env.CONTACT_FROM,
    to: [env.CONTACT_TO],
    reply_to: email,
    subject: internalSubject,
    attachments,
    html: `
      <h2>${isAutoDevis ? "Nouvelle demande – Auto-devis" : "Nouveau message – Site ProcessXcel"}</h2>
      <p><strong>Nom :</strong> ${escapeHtml(name || "-")}</p>
      <p><strong>Email :</strong> ${escapeHtml(email)}</p>
      <p><strong>Message :</strong><br>${nl2br(message)}</p>
      ${attachmentInfoHtml}
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
  const clientEmailPayload = {
    from: env.CONTACT_FROM,
    to: [email],
    reply_to: env.CONTACT_TO,
    subject: isAutoDevis
      ? "Votre estimation ProcessXcel – Bien reçu"
      : "Votre message ProcessXcel – Bien reçu",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#222">
        <h2 style="margin:0 0 8px;">Merci, nous avons bien reçu votre demande</h2>
        <p style="margin:0 0 10px;">
          Bonjour ${escapeHtml(name || "")}${name ? "," : ""}<br>
          ${isAutoDevis
            ? "Nous avons bien reçu votre demande d’estimation (auto-devis)."
            : "Nous avons bien reçu votre message."}
        </p>

        <p style="margin:0 0 14px;">
          Nous vous recontactons rapidement pour valider le besoin et examiner votre demande.
        </p>

        <div style="border:1px solid #eee;border-radius:12px;padding:12px;background:#fafafa;">
          <div style="font-size:13px;color:#555;margin-bottom:6px;"><strong>Récapitulatif</strong></div>
          <div style="font-size:14px;">${nl2br(message)}</div>
        </div>

        <p style="margin:14px 0 0;font-size:13px;color:#555;">
          ${
            attachments.length > 0
              ? "Votre pièce jointe a bien été reçue avec votre demande.<br>"
              : ""
          }
          À bientôt,<br>
          ProcessXcel<br>
          <a href="mailto:${escapeHtml(env.CONTACT_TO)}">${escapeHtml(env.CONTACT_TO)}</a>
        </p>
      </div>
    `,
  };

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