# Bot Telegram voli: setup

Bot di avvisi e preferiti per le dashboard voli (agosto 2027 e weekend da Milano). È fatto di due pezzi:

- **avvisi** su GitHub Actions (`alerts.py`, alla fine di ogni scansione), solo libreria standard di Python;
- **comandi e preferiti** su un Worker Cloudflare gratuito (`worker/`): riceve i messaggi di Telegram via webhook, quindi risponde subito, e tiene preferiti e soglie in un archivio KV che usano sia il bot sia la stella del sito.

Il bot esiste già: **@Trip2027_bot** (`bot_username` in `config.json`). Il token sta solo nei secret, mai nei file.

## Cosa fa

- **Avvisi** (`alerts.py`, alla fine di ogni scansione), in due formati (vedi "Formato dei messaggi"):
  - **alert singolo** con suono per un preferito che cala (o un'offerta molto sotto il prezzo tipico): una card per messaggio;
  - **digest** silenzioso con le mete sotto soglia (default 1.000 € A/R a persona) raggruppate per aeroporto di partenza e le rotte prima vuote su cui Google ha pubblicato i primi voli.
- **Comandi** (Worker, risposta immediata): `/start`, `/top`, `/meta`, `/preferiti`, `/aggiungi`, `/rimuovi`, `/soglia`, `/silenzia`, `/digest`, `/pausa`, `/riprendi`, `/sito`, `/help`.
- **Preferiti dal sito**: con il link personale di `/sito` la stella sulle card salva subito e c'è la pagina `#/preferiti` (vedi "Worker Cloudflare e preferiti dal sito").
- I weekend entrano negli avvisi solo se messi tra i preferiti (es. `/aggiungi w_BCN`), con soglia default 100 €. Per averli anche nel digest generale: `"weekend_global_alerts": true` in `config.json`.
- **Perimetro**: digest, `/top`, "rotte prima vuote" e card "sotto il tipico" includono solo le destinazioni della tab **Nuove mete** (`"digest_tabs": ["new"]`) e i **Popular trips** (`"digest_include_popular": true`). Le destinazioni della tab "Già visitati" e quelle con clima "sconsigliato" in `dests.py` (Delhi, Bangkok, Dubai..., `digest_exclude_clima`) compaiono solo se le metti tra i preferiti, con le normali regole dei preferiti. Per riavere tutto: `"digest_tabs": ["new", "vis"]` (o lista vuota).

### Preferiti

Per ogni preferito il bot avvisa quando il miglior prezzo a persona scende **rispetto al prezzo di riferimento** di almeno:

- **100 €** se il riferimento è sopra 1.000 € pp;
- **50 €** se il riferimento è 1.000 € pp o meno.

Le fasce stanno in `config.json`: `"fav_drop_rules": [{"above": 1000, "min_drop_eur": 100}, {"above": 0, "min_drop_eur": 50}]` (vale la prima fascia, dalla più alta, con riferimento > `above`).

- Riferimento = prezzo dell'ultimo calo notificato; per un preferito appena aggiunto (dal bot o dal sito), il miglior prezzo al momento dell'aggiunta, salvato nel preferito (`p`).
- Appena qualcuno aggiunge un preferito parte una conferma a tutte e due le chat: "⭐ Aggiunto da Cosimo: Tbilisi, oggi 190 € pp da Milano MXP". Chi lo aggiunge dal bot riceve la risposta completa al posto della riga breve.
- Un calo sotto soglia non sposta il riferimento: tre cali da 20 € di fila fanno 60 € e al terzo parte l'avviso.
- Se il prezzo risale non arriva nulla e il riferimento resta dov'è.
- Conta il miglior prezzo della meta su tutte le date e tutti gli aeroporti, quindi anche se il minimo si sposta su date diverse.
- La soglia generale di 1.000 € non c'entra: un preferito a 1.400 € che scende a 1.300 € viene notificato.
- Nel messaggio: prezzo nuovo, prezzo precedente, differenza in € e in %, date, aeroporto, scali, link alla pagina, Google Flights.

In più, sempre per i preferiti: nuove date, primi voli pubblicati, passaggio sotto la soglia del preferito (`/soglia TBS 300`, altrimenti quella generale), una volta per passaggio.

La stessa regola (100 € / 50 €, riferimento fermo sui cali piccoli) vale per i "nuovi minimi" del digest generale: una meta già segnalata da un aeroporto ricompare solo quando scende abbastanza sotto il prezzo dell'ultima segnalazione.

### Formato dei messaggi

Due tipi di messaggio, perché non tutto merita un suono.

**A. Alert singolo ("card"), con suono.** Parte per un preferito con novità (calo oltre soglia, primi voli, passaggio sotto la sua soglia, nuove date) e per un'offerta del digest almeno il 30% sotto il prezzo tipico della meta (`card_discount_pct`). Una card per messaggio:

```
📉 Tbilisi (Georgia): 190 € pp · coppia 380 €
   mer 11 → dom 22 ago · 11 notti · da Milano MXP · diretto · easyJet · Google Flights
   📉 sceso da 260 € a 190 € pp: -70 € (-27%)
   📊 tipico 245 € pp: ora 55 € sotto (-22%)
[🔗 Apri pagina] [✈️ Voli su Google]
[❌ Rimuovi preferito] [🔕 Silenzia 7 gg]
```

- La prima riga (meta + prezzo a persona) è quella che si legge nell'anteprima della notifica.
- "Sceso da" confronta con il riferimento del preferito; "tipico" è la mediana dei minimi giornalieri della meta nelle scansioni precedenti (`state/history.json`) e compare dopo almeno 5 giorni di storia (`typical_min_samples`).
- Se la meta ha una foto di copertina (`img/manifest.json` del sito) la card la mostra grande sopra il testo, come anteprima del link `<dashboard_url>img/<file>`. Se la foto non è raggiungibile il messaggio arriva lo stesso, solo testo. Si spegne con `"card_cover": false`.
- "Silenzia 7 gg" ferma gli avvisi su quella meta per una settimana (`mute_days`); i prezzi continuano a essere seguiti e alla riattivazione un calo accumulato viene segnalato. Da comando: `/silenzia TBS`, `/silenzia TBS 14`, `/silenzia TBS off`, `/silenzia` per l'elenco.
- Limiti contro lo spam: massimo 3 card per giro (`max_cards_per_run`) e 6 al giorno (`max_alerts_per_day`, 0 = nessun limite). Quello che eccede non si perde: finisce nel digest.
- Ore di silenzio 23:00-08:00 ora italiana (`quiet_hours`): le card partono lo stesso ma senza suono.

**B. Digest del giro, silenzioso** (`digest_silent`), senza anteprime dei link:

```
✈️ 20 novità · da 200 € pp Agadir, costa atlantica (MXP)
Offerte sotto 1.000 € a persona, per aeroporto di partenza

🛫 Milano Linate (LIN) · 2 mete da 320 € pp
• Erevan (Armenia): 320 € pp · coppia 640 € · mar 10 → ven 20 ago · 1 scalo · voli
• Singapore (Singapore): 883 € pp · coppia 1.766 € · mer 11 → dom 22 ago · 1 scalo · voli

🛫 Milano Malpensa (MXP) · 10 mete da 200 € pp
┃ • Agadir, costa atlantica (Marocco): 200 € pp · coppia 400 € · sab 14 → mar 24 ago · diretto · voli
┃ • Erevan (Armenia): 350 € pp · coppia 700 € · ven 13 → mer 25 ago · diretto · voli
┃ • Kayseri, Cappadocia (Turchia): 558 € pp · … (tocca per aprire: altre 3 righe + "e altre 4 mete")

🛫 Roma (FCO/CIA) · 8 mete da 230 € pp
┃ • Erevan (Armenia): 230 € pp · coppia 460 € · mar 10 → ven 20 ago · diretto · voli
┃ …
[Apri Agadir] [Apri Erevan] …
```

- Riga di riepilogo in testa: quante novità e il miglior prezzo, così il valore si capisce dall'elenco delle chat.
- Sezioni per aeroporto di partenza, in quest'ordine: **Milano Linate (LIN)**, **Milano Malpensa (MXP)**, **Roma (FCO/CIA)**, **Pisa (PSA)** (più Bergamo per i weekend e, in coda, eventuali aeroporti non previsti). Per cambiarle: `"origin_sections": [{"title": "Roma (FCO/CIA)", "codes": ["FCO", "CIA"]}, ...]`.
- Il titolo di sezione dice quante mete e da che prezzo. Dentro, una riga per destinazione o trip: nome linkato alla pagina, prezzo pp, coppia, date, scali, link ai voli; in ordine di prezzo pp. Dove c'è storia sufficiente, "-22% sul tipico".
- La stessa meta non viene accorpata tra aeroporti: ogni sezione mostra il miglior prezzo da quell'aeroporto.
- Massimo 6 righe per sezione (`section_max_rows`), poi "e altre N mete". Le sezioni con più di 3 righe (`section_expand_after`) stanno in un riquadro richiudibile (`<blockquote expandable>`): chiuso mostra le prime righe, si apre con un tocco.
- I preferiti che non sono partiti come card (oltre il tetto) sono in coda, raggruppati allo stesso modo sotto l'aeroporto del loro miglior prezzo.
- Il testo viene spezzato in più messaggi sotto i 4.096 caratteri di Telegram, senza tagliare una sezione a metà.
- Frequenza: `/digest` propone "a ogni giro", "giornaliero", "settimanale" (default `digest_frequency: "giro"`). Con giornaliero o settimanale le novità si accumulano e arrivano tutte insieme; le card dei preferiti restano immediate.

Date sempre in formato breve con il giorno della settimana ("ven 13 → mar 24 ago"), prezzo a persona in grassetto, coppia accanto.

### Link nei messaggi

Il nome di ogni meta è un link alla sua pagina sul sito, non alla home:

| Tipo | Link |
|---|---|
| Destinazione | `<dashboard_url>#/d/<IATA>`, es. `.../#/d/TBS` |
| Popular trip | `<dashboard_url>#/t/<trip.id>`, es. `.../#/t/georgia-armenia` |
| Weekend | `https://cosimoney.github.io/flightsMI/` |

`dashboard_url` è la base: si imposta con la variabile `DASHBOARD_URL` del repo (o in `config.json`). Finché resta il segnaposto `REPO-DA-DEFINIRE` i nomi escono senza link. Sotto al digest ci sono i pulsanti "Apri" (massimo 6: prima i preferiti, poi le mete più economiche); le card hanno "Apri pagina" e "Voli su Google". Google Flights resta come link secondario in coda alla riga.

### Origini

Lo snapshot accetta qualsiasi aeroporto di partenza presente nei dati: oggi LIN e MXP, con la riscansione anche Roma FCO e Pisa PSA. Nei messaggi compaiono come "da Milano MXP", "da Roma FCO", "da Pisa"; un codice sconosciuto esce così com'è (per dargli un nome: `"origin_names": {"CIA": "Roma CIA"}` in `config.json`).
Il prezzo confrontato e notificato è **solo quello del volo**: nessun costo di treno o posizionamento viene aggiunto.
L'origine fa parte dell'id dell'offerta (`d_TBS:FCO:2027-08-07:2027-08-18`), quindi le stesse date da due aeroporti restano due offerte distinte.

File letti da `snapshot.py`, nella radice del repo:
- agosto 2027: `raw.jsonl` e `raw_v2.jsonl`, quelli che esistono; per la stessa query vince `raw_v2.jsonl`. Quando la riscansione v2 è completa conviene togliere `raw.jsonl` dal repo, così non restano query vecchie. Con `--raw FILE` si legge solo quel file;
- popular trips: `trips_data.json` (prodotto da `build_trips.py`), altrimenti `trips_raw_v2.jsonl`, altrimenti `trips_raw.jsonl`.

## Worker Cloudflare e preferiti dal sito

Codice in `worker/` (JavaScript senza dipendenze): `src/index.js` (rotte, firma dei link, Telegram, KV) e `src/bot.js` (i comandi, stessa logica e stessi testi di `commands.py`).

| Rotta | A cosa serve | Chi può chiamarla |
|---|---|---|
| `POST /api/fav` `{id, on}` | aggiunge o toglie un preferito | sito, con il token personale |
| `GET /api/favs` | preferiti con chi li ha aggiunti, quando, prezzo all'aggiunta e prezzo di oggi | sito, con il token personale |
| `GET /api/prefs` | preferenze complete (stessa struttura di `state/prefs.json`) | `alerts.py`, con `PREFS_SECRET` |
| `POST /tg/<WEBHOOK_SECRET>` | webhook di Telegram | Telegram (header `X-Telegram-Bot-Api-Secret-Token`) |

- **Stato**: KV `PREFS`, chiave `prefs` (soglia, preferiti, pause, mete silenziate, frequenza del riepilogo) e chiave `auth` (versione dei link per chat). Ogni preferito porta `added`, `at` (data e ora), `by` (chi), `p` (prezzo all'aggiunta), `thr` (soglia propria).
- **Dati dei voli**: il Worker legge `bot/snapshot_lite.json` dal branch `data` (lo scrive `snapshot.py` a ogni giro: per ogni meta l'offerta migliore, tre date alternative e l'elenco dei prezzi). Se manca usa `bot/snapshot.json`. Tiene i dati in memoria 5 minuti.
- **Accesso dal sito**: `/sito` sul bot risponde con `https://cosimoney.github.io/agosto2027/#/login/<token>`. Il token contiene il chat_id ed è firmato dal Worker (HMAC-SHA256 con `HMAC_SECRET`). Il sito lo salva nel browser (localStorage), lo toglie dall'indirizzo e lo manda come `Authorization: Bearer`. Lo stesso link vale su più dispositivi.
  - `/sito nuovo` annulla i link già creati per chi lo scrive e ne manda uno nuovo.
  - Per annullare tutti i link di tutti: `ROTATE_HMAC=1 bash worker/deploy.sh`.
  - Senza token la stella resta il link `t.me/Trip2027_bot?start=fav_<ID>` e la pagina Preferiti mostra solo come ottenere il link: l'elenco non è pubblico.
- **CORS**: le API rispondono al browser solo per l'origine `https://cosimoney.github.io`.
- **Avvisi**: `alerts.py` legge i preferiti da `GET <WORKER_URL>/api/prefs`. Se il Worker non risponde usa l'ultima copia ricevuta (in `state/notified.json`, campo `prefs_cache`) e poi `state/prefs.json`. Lo stato degli avvisi resta in `bot/state/`. La chiave è `PREFS_SECRET` se il workflow la passa, altrimenti una chiave derivata dal token del bot che il Worker accetta allo stesso modo: così funziona anche senza toccare `scan.yml`.
- **Sito**: l'indirizzo del Worker sta in `bot/config.json` (`worker_url`); `build_v2.py` lo mette nella pagina. Vuoto = stella solo via Telegram, nessuna voce Preferiti nel menu.

### Deploy (una volta, o quando cambia il codice del Worker)

```bash
npx wrangler login            # apre il browser: accesso all'account Cloudflare
cd worker
export TELEGRAM_BOT_TOKEN='...' TELEGRAM_CHAT_IDS='111,222' CHAT_NAMES='111:Cosimo,222:Lavi' TEST_CHAT_ID='111'
bash deploy.sh
```

`deploy.sh` crea il KV, pubblica, imposta i secret del Worker senza mostrarli (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS`, `CHAT_NAMES`, `HMAC_SECRET`, `PREFS_SECRET`, `WEBHOOK_SECRET`), mette nel repo il secret `PREFS_SECRET` e la variabile `WORKER_URL`, importa `state/prefs.json` nel KV se è vuoto, imposta il webhook, registra il menu, disattiva il workflow dei comandi in polling, scrive `worker_url` in `config.json` e lancia le prove dal vivo (`smoke.mjs`: un solo messaggio vero, la risposta a un `/help` finto alla chat di prova). Alla fine restano il commit e il push di `worker/wrangler.toml` e `bot/config.json`.

Per aggiornare solo il codice basta `npx wrangler deploy` dalla cartella `worker/`.

### Prove

```bash
cd worker && npm test          # firma dei link, API, CORS, webhook con update finti, chat non autorizzata, confronto con commands.py
node test_v2.js                # sito: stella, pagina preferiti, login (dalla radice del repo, dopo python build_v2.py)
```

### Tornare al polling

`deleteWebhook` su Telegram e `gh workflow enable bot-commands.yml`: il bot torna a rispondere dal workflow, con i preferiti di `state/prefs.json` (non quelli del KV).

## Passi per Cosimo

### 1. Bot e chat
Già fatto: il bot è `@Trip2027_bot` e le chat autorizzate sono due (Cosimo e Lavi).
Per aggiungere un'altra chat o un gruppo: la persona apre il bot e preme **Avvia** (in un gruppo: si aggiunge il bot e si scrive `/start`), poi in PowerShell dalla cartella del progetto:
```powershell
$env:TELEGRAM_BOT_TOKEN = "IL_TOKEN"
.\.venv\Scripts\python.exe bot\commands.py --whoami
```
Stampa una riga per chat, per esempio `chat_id 123456789 (private Cosimo)`. I gruppi hanno id negativo.
Il comando funziona solo in locale: su Actions è bloccato perché i log di un repo pubblico sono pubblici.

### 2. Metti i secret nel repo
```powershell
gh secret set TELEGRAM_BOT_TOKEN --repo cosimoney/NOME-REPO      # incolla il token quando lo chiede
gh secret set TELEGRAM_CHAT_IDS --repo cosimoney/NOME-REPO --body "123456789,987654321"
gh variable set DASHBOARD_URL --repo cosimoney/NOME-REPO --body "https://cosimoney.github.io/NOME-REPO/"
```
`TELEGRAM_CHAT_IDS` è l'elenco delle chat autorizzate, separate da virgola. Funziona con una sola chat come con dieci: per aggiungere o togliere qualcuno basta riscrivere il secret, il codice non cambia.

### 3. Registra il menu dei comandi (una volta)
```powershell
.\.venv\Scripts\python.exe bot\commands.py --register
```

### 4. Prova
- Dal vero: scrivi `/top` o `/sito` al bot, risponde in un paio di secondi.
- In locale, senza inviare nulla:
  ```powershell
  .\.venv\Scripts\python.exe bot\selftest.py
  .\.venv\Scripts\python.exe bot\snapshot.py
  .\.venv\Scripts\python.exe bot\alerts.py --dry-run
  .\.venv\Scripts\python.exe bot\commands.py --dry-run --simulate "/top"
  ```
  Da Git Bash i comandi che iniziano con `/` vengono scambiati per percorsi: usare PowerShell oppure `MSYS_NO_PATHCONV=1`.

## Dati sensibili: come sono protetti

Il repo è pubblico, quindi:
- token e chat_id stanno solo nei secret di Actions e del Worker, mai nei file (lo verifica anche `selftest.py`);
- il bot risponde solo alle chat in `TELEGRAM_CHAT_IDS`; le altre vengono ignorate in silenzio;
- preferiti e soglie stanno nel KV del Worker, non più nel repo. Nello stato committato (`bot/state/*.json`) restano prezzi, riferimenti degli avvisi e una copia delle preferenze (`prefs_cache`: mete, importi, nome di chi ha aggiunto). L'unico riferimento a una chat è la pausa (`/pausa`), salvata come hash HMAC-SHA256 del chat_id con il token come chiave: senza il token non si risale al chat_id;
- il link personale del sito contiene il chat_id firmato: va trattato come una password (non inoltrarlo). Chi lo ha può solo leggere, aggiungere e togliere preferiti;
- i log dei workflow riportano solo conteggi, mai id, nomi o testo dei messaggi;
- preferiti e soglie sono condivisi tra le chat autorizzate (tu e Lavi vedete la stessa lista).

Se il token finisce per sbaglio in giro: `/revoke` su BotFather, nuovo `gh secret set TELEGRAM_BOT_TOKEN` e di nuovo `bash worker/deploy.sh` con il token nuovo (aggiorna il secret del Worker e il webhook). Le pause salvate decadono, il resto resta valido.

Le richieste a Telegram partono come JSON con escape ASCII (`€` viaggia come `€`), quindi non dipendono dalla codifica del terminale o del runner.

## Formato degli ID e deep link

| Tipo | ID | Esempio |
|---|---|---|
| Destinazione agosto 2027 | `d_<IATA>` | `d_TBS` |
| Popular trip | `t_<id del trip in popular_trips.py>` | `t_georgia-armenia` |
| Weekend da Milano | `w_<IATA>` | `w_BCN` |

Stella "aggiungi ai preferiti" sulle card della dashboard:

```
https://t.me/Trip2027_bot?start=fav_<ID>
```

Esempio: `https://t.me/Trip2027_bot?start=fav_d_TBS`. Telegram apre il bot, l'utente preme **Avvia** e il bot riceve `/start fav_d_TBS`.
È il comportamento della stella per chi non ha ancora aperto il link personale di `/sito`; con il link la stella salva direttamente dal sito. `?start=sito` equivale a `/sito`.
Vincoli di Telegram sul parametro: solo `A-Z a-z 0-9 _ -`, massimo 64 caratteri. Gli ID attuali li rispettano tutti (lo verifica `selftest.py`).
Un ID valido ma non ancora presente nei dati viene accettato: il bot avvisa quando compaiono i primi voli.

## File

| File | Ruolo |
|---|---|
| `snapshot.py` | Normalizza `raw.jsonl` / `raw_v2.jsonl`, `trips_data.json` e la pagina weekend in `snapshot.json`, più `snapshot_lite.json` per il Worker |
| `alerts.py` | Confronta lo snapshot con lo stato e invia il digest |
| `commands.py` | Riferimento dei comandi (gli stessi del Worker), prove in locale con `--simulate`, `--register` per il menu. Dal vivo non gira più |
| `../worker/src/bot.js`, `../worker/src/index.js` | Comandi, webhook, API dei preferiti, link personali |
| `../worker/deploy.sh`, `../worker/smoke.mjs` | Deploy completo e prove dal vivo |
| `common.py` | Config, stato, client Telegram, formattazione, link alle pagine |
| `config.json` | Soglie di default, URL delle dashboard, username del bot, regole (nessun segreto) |
| `selftest.py` | Test completo senza rete |
| `state/prefs.json`, `state/offset.json` | Stato del vecchio polling. `prefs.json` è l'ultimo ripiego di `alerts.py` e la base della migrazione nel KV |
| `state/last_snapshot.json`, `state/notified.json`, `state/history.json` | Scritti da `alerts.py` (`history.json`: minimo giornaliero per meta, ultimi 90 giorni, serve al "prezzo tipico") |
| `workflows_draft/` | Bozze dei workflow, da spostare in `.github/workflows/` |

## Limiti da sapere

- **Tempi di risposta**: i comandi passano dal Worker e la risposta arriva in uno o due secondi. `/top` e `/meta` usano i dati dell'ultimo giro di scansione.
- **Due persone nello stesso istante**: il KV non ha transazioni. Se tu e Lavi cambiate i preferiti nello stesso secondo può restare solo una delle due modifiche. Basta ripetere.
- **Piano gratuito Cloudflare**: 100.000 richieste e 1.000 scritture nel KV al giorno, molto più di quanto serve a due persone.
- **Repo inattivo**: GitHub sospende i workflow schedulati dopo 60 giorni senza commit. I commit giornalieri dello scan lo tengono attivo.
- **Popular trips open-jaw**: il prezzo è la somma di due solo-andata (stima del multi-city, come nella dashboard) più eventuali tratte stimate, indicate nel messaggio.
- **Avvisi in pausa**: chi è in pausa non riceve il digest di quel giro e non lo recupera dopo.
- **Cadenza**: gli avvisi arrivano con la cadenza dello scan, non in tempo reale.
- **Pulsanti delle card**: "Silenzia" e "Rimuovi preferito" li gestisce il Worker, la conferma è immediata.
- **Foto nelle card**: Telegram scarica la foto dall'URL pubblico del sito; finché il sito non è online (o `DASHBOARD_URL` non è impostata) le card sono solo testo.
- **Prezzo tipico**: nei primi 5 giorni di scansioni non c'è abbastanza storia e la riga "tipico" non compare.
