// =====================================================================
// Sofferenza Infernale · funzione server (Supabase Edge Function, Deno)
// Custodisce i segreti (Strava client secret, token, chiavi Intervals)
// e fa le chiamate che il browser non può fare da solo.
//
// Segreti richiesti (Supabase → Edge Functions → Secrets):
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
// Forniti automaticamente da Supabase:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const STRAVA_ID = Deno.env.get("STRAVA_CLIENT_ID") ?? "";
const STRAVA_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET") ?? "";
const STRAVA_API = "https://www.strava.com/api/v3";
// Numero massimo di persone che possono collegare Strava (modificabile con il secret STRAVA_MAX_ATHLETES)
const STRAVA_MAX = Math.max(1, Number(Deno.env.get("STRAVA_MAX_ATHLETES") ?? "4") || 4);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

// ---------------- Strava ----------------
async function stravaToken(params: Record<string, string>) {
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: STRAVA_ID, client_secret: STRAVA_SECRET, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(400, "Strava: " + (j.message ?? r.status));
  return j;
}

async function validStravaAccess(userId: string): Promise<string> {
  const { data: t } = await admin.from("strava_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!t) throw new HttpError(409, "Strava non collegato");
  if (t.expires_at - 120 > Date.now() / 1000) return t.access_token;
  const n = await stravaToken({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  await admin.from("strava_tokens").update({
    access_token: n.access_token, refresh_token: n.refresh_token, expires_at: n.expires_at,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return n.access_token;
}

async function stravaUpload(userId: string, tcx: string, name: string, description: string, externalId: string) {
  const token = await validStravaAccess(userId);
  const fd = new FormData();
  fd.append("file", new Blob([tcx], { type: "application/xml" }), "rullo.tcx");
  fd.append("data_type", "tcx");
  fd.append("name", name);
  fd.append("description", description);
  fd.append("trainer", "1");
  fd.append("external_id", externalId);
  const r = await fetch(STRAVA_API + "/uploads", { method: "POST", headers: { Authorization: "Bearer " + token }, body: fd });
  let up = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: up.message ?? ("HTTP " + r.status) };
  // Strava elabora il file in modo asincrono: attendiamo l'id dell'attività
  for (let i = 0; i < 10 && !up.activity_id && !up.error; i++) {
    await sleep(1500);
    const s = await fetch(STRAVA_API + "/uploads/" + up.id, { headers: { Authorization: "Bearer " + token } });
    up = await s.json().catch(() => up);
  }
  if (up.error) {
    const dup = /duplicate of activity (\d+)/i.exec(String(up.error));
    if (dup) return { ok: true, activity_id: Number(dup[1]), duplicate: true };
    return { ok: false, error: String(up.error) };
  }
  return { ok: true, activity_id: up.activity_id ?? null, pending: !up.activity_id };
}

// ---------------- Intervals.icu ----------------
async function icuCreds(userId: string) {
  const { data: p } = await admin.from("profiles").select("icu_athlete_id, icu_api_key").eq("id", userId).maybeSingle();
  if (!p?.icu_api_key) throw new HttpError(409, "Intervals.icu non configurato nel profilo");
  return { id: encodeURIComponent((p.icu_athlete_id || "0").trim() || "0"), auth: "Basic " + btoa("API_KEY:" + p.icu_api_key.trim()) };
}

async function icuEvents(userId: string, oldest: string, newest: string) {
  const c = await icuCreds(userId);
  const r = await fetch(`https://intervals.icu/api/v1/athlete/${c.id}/events?oldest=${oldest}&newest=${newest}&category=WORKOUT&ext=zwo&resolve=true`,
    { headers: { Authorization: c.auth, Accept: "application/json" } });
  if (r.status === 401 || r.status === 403) throw new HttpError(401, "Chiave Intervals.icu o ID atleta non validi");
  if (!r.ok) throw new HttpError(502, "Intervals.icu HTTP " + r.status);
  return await r.json();
}

async function icuUpload(userId: string, tcx: string, name: string, description: string, externalId: string) {
  const c = await icuCreds(userId);
  const fd = new FormData();
  fd.append("file", new Blob([tcx], { type: "application/xml" }), "rullo.tcx");
  const q = new URLSearchParams({ name, description, external_id: externalId });
  const r = await fetch(`https://intervals.icu/api/v1/athlete/${c.id}/activities?${q}`, {
    method: "POST", headers: { Authorization: c.auth }, body: fd,
  });
  const txt = await r.text();
  if (!r.ok) return { ok: false, error: "Intervals.icu HTTP " + r.status + (txt ? ": " + txt.slice(0, 200) : "") };
  let j: any = {};
  try { j = JSON.parse(txt); } catch { /* risposta non JSON */ }
  const id = j.id ?? j.activities?.[0]?.id ?? null;
  return { ok: true, activity_id: id };
}

// ---------------- Router ----------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !u?.user) throw new HttpError(401, "Accesso richiesto");
    const userId = u.user.id;
    const body = await req.json().catch(() => ({}));

    switch (body.action) {
      case "strava_status": {
        const { data } = await admin.from("strava_tokens").select("athlete_name, athlete_id").eq("user_id", userId).maybeSingle();
        const { count } = await admin.from("strava_tokens").select("user_id", { count: "exact", head: true });
        return json({ connected: !!data, athlete_name: data?.athlete_name ?? null, configured: !!(STRAVA_ID && STRAVA_SECRET),
          used: count ?? 0, max: STRAVA_MAX });
      }
      case "strava_connect": {
        if (!body.code) throw new HttpError(400, "codice mancante");
        const { count } = await admin.from("strava_tokens").select("user_id", { count: "exact", head: true }).neq("user_id", userId);
        if ((count ?? 0) >= STRAVA_MAX) throw new HttpError(409, `Posti Strava esauriti (${STRAVA_MAX}/${STRAVA_MAX}): chiedi a chi gestisce Rullo di liberarne uno`);
        const t = await stravaToken({ grant_type: "authorization_code", code: String(body.code) });
        const a = t.athlete ?? {};
        const name = [a.firstname, a.lastname].filter(Boolean).join(" ") || null;
        await admin.from("strava_tokens").upsert({
          user_id: userId, athlete_id: a.id ?? null, athlete_name: name,
          access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at,
          updated_at: new Date().toISOString(),
        });
        return json({ connected: true, athlete_name: name, scope: body.scope ?? null });
      }
      case "strava_disconnect": {
        try {
          const token = await validStravaAccess(userId);
          await fetch("https://www.strava.com/oauth/deauthorize", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ access_token: token }),
          });
        } catch { /* già scollegato */ }
        await admin.from("strava_tokens").delete().eq("user_id", userId);
        return json({ connected: false });
      }
      case "icu_events": {
        return json(await icuEvents(userId, String(body.oldest), String(body.newest)));
      }
      case "upload": {
        const tcx = String(body.tcx ?? "");
        if (tcx.length < 100) throw new HttpError(400, "file attività vuoto");
        if (tcx.length > 15_000_000) throw new HttpError(413, "file troppo grande");
        const name = String(body.name ?? "Sofferenza Infernale").slice(0, 200);
        const desc = String(body.description ?? "Allenamento indoor con Sofferenza Infernale").slice(0, 2000);
        const ext = String(body.external_id ?? ("rullo-" + Date.now())).slice(0, 100);
        const targets: string[] = Array.isArray(body.targets) ? body.targets : [];
        const out: Record<string, unknown> = {};
        const jobs: Promise<void>[] = [];
        if (targets.includes("strava")) jobs.push(stravaUpload(userId, tcx, name, desc, ext).then((r) => { out.strava = r; }).catch((e) => { out.strava = { ok: false, error: e.message }; }));
        if (targets.includes("icu")) jobs.push(icuUpload(userId, tcx, name, desc, ext).then((r) => { out.icu = r; }).catch((e) => { out.icu = { ok: false, error: e.message }; }));
        await Promise.all(jobs);
        // collega gli id esterni alla riga dello storico
        if (body.activity_row_id) {
          const patch: Record<string, unknown> = {};
          const s = out.strava as any, i = out.icu as any;
          if (s?.ok && s.activity_id) patch.strava_activity_id = s.activity_id;
          if (i?.ok && i.activity_id) patch.icu_activity_id = String(i.activity_id);
          if (Object.keys(patch).length) await admin.from("activities").update(patch).eq("id", body.activity_row_id).eq("user_id", userId);
        }
        return json(out);
      }
      default:
        throw new HttpError(400, "azione sconosciuta");
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message ?? String(e) }, status);
  }
});
