# Sofferenza Infernale · guida per metterlo online con account e Strava

Tempo: circa 30–40 minuti, una volta sola. Servono 3 account gratuiti (GitHub, Supabase, Strava) e un abbonamento Strava attivo per il tuo account sviluppatore (regola di Strava dal 1° giugno 2026).

Alla fine avrai un link tipo `https://tuonome.github.io/sofferenza-infernale/`: ogni amico apre il link, entra con la sua email e collega il suo Strava e il suo Intervals.icu.

---

## 1 · GitHub Pages (il sito)

1. Crea un account su **github.com**.
2. **New repository** → nome `sofferenza-infernale` → Public → Create.
3. **Add file → Upload files**: trascina tutti i file di questa cartella (anche la cartella `supabase`) → **Commit changes**.
4. **Settings → Pages** → Source: *Deploy from a branch* → Branch `main` / `/ (root)` → Save.
5. Dopo 1–2 minuti il sito è su `https://TUONOME.github.io/sofferenza-infernale/`. Annota questo indirizzo: è il **link dell'app**.

Già adesso l'app funziona in modalità locale (senza account).

## 2 · Supabase (account e database)

1. Crea un account su **supabase.com** → **New project** (regione consigliata: *Central EU (Zurich)* o *Frankfurt*). Scegli una password per il database e salvala.
2. Menu **SQL Editor** → *New query* → incolla tutto il contenuto di `supabase/schema.sql` → **Run**. Deve dire *Success*.
3. **Authentication → URL Configuration**:
   - *Site URL*: il link dell'app (es. `https://tuonome.github.io/sofferenza-infernale/`)
   - *Redirect URLs*: aggiungi lo stesso link.
4. **Project Settings → API** (o *API Keys*): copia
   - **Project URL** (es. `https://abcd1234.supabase.co`)
   - la chiave **anon** / **publishable** (quella pubblica, *non* la `service_role`/secret).

> Le email di accesso: Supabase include un invio email gratuito con un limite basso di messaggi all'ora. Per voi amici basta; se un giorno non arrivano, in *Authentication → Emails* puoi collegare un servizio SMTP tuo.

## 3 · Strava (app sviluppatore)

1. Vai su **strava.com/settings/api** e crea un'applicazione:
   - *Application Name*: `Sofferenza Infernale`
   - *Category*: Training
   - *Website*: il link dell'app
   - *Authorization Callback Domain*: **solo il dominio**, es. `tuonome.github.io`
2. Annota **Client ID** e **Client Secret** (il secret non va mai messo nel sito).
3. Una nuova app Strava parte con **1 atleta collegabile** (tu). Per voi 4 chiedi l'aumento di capacità dalla pagina dell'app o dal programma sviluppatori Strava: fino a 10 atleti non serve la revisione completa.
4. L'app accetta al massimo **4 collegamenti Strava** (chi arriva quinto vede "posti esauriti"). Per cambiare il numero aggiungi il secret `STRAVA_MAX_ATHLETES` nel passo 4.5 (senza superare la capacità concessa da Strava).

## 4 · La funzione server (Supabase Edge Function)

1. In Supabase: **Edge Functions → Deploy a new function → Via Editor**.
2. Nome: **`rullo`** (esattamente così: è il nome tecnico interno).
3. Cancella il codice di esempio e incolla tutto `supabase/functions/rullo/index.ts` → **Deploy**.
4. Nelle impostazioni della funzione **disattiva "Verify JWT"** (la funzione controlla da sola chi è collegato).
5. **Edge Functions → Secrets** → aggiungi:
   - `STRAVA_CLIENT_ID` = il Client ID di Strava
   - `STRAVA_CLIENT_SECRET` = il Client Secret di Strava

## 5 · Collegare il sito al cloud

1. Su GitHub apri il file **`config.js`** → icona matita (Edit) e compila:

```js
window.RULLO_CONFIG = {
  supabaseUrl: "https://abcd1234.supabase.co",
  supabaseAnonKey: "LA_TUA_CHIAVE_ANON_O_PUBLISHABLE",
  stravaClientId: "123456"
};
```

2. **Commit changes**. Dopo 1 minuto ricarica l'app: in alto a destra compare **Accedi**.

## 6 · Prova

1. **Accedi** → inserisci la tua email → apri il link ricevuto.
2. Clicca sul tuo nome → **Il mio profilo**: controlla FTP e peso, inserisci ID atleta e chiave API di Intervals.icu, premi **Collega Strava** e autorizza (lascia la spunta su *carica attività*).
3. Fai 2 minuti in modalità demo e premi **Termina**: l'uscita compare in *Le mie uscite* e su Strava.
   *(In demo i dati sono finti: cancella poi l'attività di prova su Strava.)*

## Gli amici

Mandagli il link. Ognuno: **Accedi** con la propria email → profilo → collega il proprio Strava e Intervals. Ognuno vede solo i propri dati.
Su Chrome (Mac/PC/Android) possono premere **⬇ Installa app** per averla come app vera.

## Garmin

Garmin ha sospeso le nuove richieste di accesso alle sue API (2026), quindi un collegamento diretto non è possibile. Alternative:
- collega Garmin al tuo **Intervals.icu** (Intervals → Settings → Garmin);
- oppure scarica il **.tcx** a fine uscita e caricalo su Garmin Connect (*Importa dati*).

## Problemi comuni

| Sintomo | Soluzione |
|---|---|
| "Accedi" non compare | `config.js` non compilato o non ancora aggiornato: attendi 1 min e ricarica con Cmd+Shift+R |
| Il link email porta a una pagina sbagliata | Controlla *Site URL* e *Redirect URLs* in Supabase (passo 2.3) |
| Strava: "redirect_uri invalid" | *Authorization Callback Domain* deve essere solo `tuonome.github.io` |
| Strava: errore limite atleti | Capacità dell'app ancora a 1: chiedi l'aumento a 10 (passo 3.3) |
| "Strava non configurato sul server" | Mancano i Secrets della funzione (passo 4.5) |
| Errore 401 dalla funzione | Disattiva *Verify JWT* sulla funzione (passo 4.4) |
