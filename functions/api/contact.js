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

  const emailPayload = {
    from: env.CONTACT_FROM,
    to: [env.CONTACT_TO],
    reply_to: data.email,
    subject: `Nouveau message site – ${data.name || "Contact"}`,
    html: `
      <h2>Nouveau message – Site ProcessXcel</h2>
      <p><strong>Nom :</strong> ${data.name || "-"}</p>
      <p><strong>Email :</strong> ${data.email}</p>
      <p><strong>Téléphone :</strong> ${data.phone || "-"}</p>
      <p><strong>Message :</strong><br>${data.message.replace(/\n/g, "<br>")}</p>
    `,
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(emailPayload),
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Email failed" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
}
