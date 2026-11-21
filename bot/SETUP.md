# Bot Telegram voli: setup

Bot di avvisi e preferiti per le dashboard voli (agosto 2027 e weekend da Milano). Gira su GitHub Actions, senza server.
Usa solo la libreria standard di Python.

Il bot esiste già: **@Trip2027_bot** (`bot_username` in `config.json`). Il token sta solo nei secret, mai nei file.

## Cosa fa

- **Avvisi** (`alerts.py`, alla fine di ogni scansione), in due formati (vedi "Formato dei messaggi"):
  - **alert singolo** con suono per un preferito che cala (o un'offerta molto sotto il prezzo tipico): una card per messaggio;
  - **digest** silenzioso con le mete sotto soglia (default 1.000 € A/R a persona) raggruppate per aeroporto di partenza e le rotte prima vuote su cui Google ha pubblicato i primi voli.
- **Comandi** (`commands.py`, ogni ~13 minuti): `/start`, `/top`, `/meta`, `/preferiti`, `/aggiungi`, `/rimuovi`, `/soglia`, `/silenzia`, `/digest`, `/pausa`, `/riprendi`, `/help`.
- I weekend entrano negli avvisi solo se messi tra i preferiti (es. `/aggiungi w_BCN`), con soglia default 100 €. Per averli anche nel digest generale: `"weekend_global_alerts": true` in `config.json`.
- **Perimetro**: digest, `/top`, "rotte prima vuote" e card "sotto il tipico" includono solo le destinazioni della tab **Nuove mete** (`"digest_tabs": ["new"]`) e i **Popular trips** (`"digest_include_popular": true`). Le destinazioni della tab "Già visitati" e quelle con clima "sconsigliato" in `dests.py` (Delhi, Bangkok, Dubai..., `digest_exclude_clima`) compaiono solo se le metti tra i preferiti, con le normali regole dei preferiti. Per riavere tutto: `"digest_tabs": ["new", "vis"]` (o lista vuota).

### Preferiti

Per ogni preferito il bot avvisa quando il miglior prezzo a persona scende **rispetto al prezzo di riferimento** di almeno:

- **100 €** se il riferimento è sopra 1.000 € pp;
- **50 €** se il riferimento è 1.000 € pp o meno.

Le fasce stanno in `config.json`: `"fav_drop_rules": [{"above": 1000, "min_drop_eur": 100}, {"above": 0, "min_drop_eur": 50}]` (vale la prima fascia, dalla più alta, con riferimento > `above`).

- Riferimento = prezzo dell'ultimo calo notificato; per un preferito appena aggiunto, il prezzo mostrato dal bot al momento dell'aggiunta.
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
- In locale, senza inviare nulla:
  ```powershell
  .\.venv\Scripts\python.exe bot\selftest.py
  .\.venv\Scripts\python.exe bot\snapshot.py
  .\.venv\Scripts\python.exe bot\alerts.py --dry-run
  .\.venv\Scripts\python.exe bot\commands.py --dry-run --simulate "/top"
  ```
  Da Git Bash i comandi che iniziano con `/` vengono scambiati per percorsi: usare PowerShell oppure `MSYS_NO_PATHCONV=1`.
- Dal vero: su GitHub lancia a mano il workflow "Bot Telegram - comandi" e scrivi `/top` al bot.

## Dati sensibili: come sono protetti

Il repo è pubblico, quindi:
- token e chat_id stanno solo nei secret di Actions, mai nei file (lo verifica anche `selftest.py`);
- il bot risponde solo alle chat in `TELEGRAM_CHAT_IDS`; le altre vengono ignorate in silenzio;
- nello stato committato (`bot/state/*.json`) ci sono solo preferiti, soglie, offset e prezzi. L'unico riferimento a una chat è la pausa (`/pausa`), salvata come hash HMAC-SHA256 del chat_id con il token come chiave: senza il token non si risale al chat_id;
- i log dei workflow riportano solo conteggi, mai id, nomi o testo dei messaggi;
- preferiti e soglie sono condivisi tra le chat autorizzate (tu e Lavi vedete la stessa lista). Chiunque può leggerli nel repo: sono solo nomi di mete e importi.

Se il token finisce per sbaglio in giro: `/revoke` su BotFather e nuovo `gh secret set TELEGRAM_BOT_TOKEN`. Le pause salvate decadono, il resto resta valido.

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
Vincoli di Telegram sul parametro: solo `A-Z a-z 0-9 _ -`, massimo 64 caratteri. Gli ID attuali li rispettano tutti (lo verifica `selftest.py`).
Un ID valido ma non ancora presente nei dati viene accettato: il bot avvisa quando compaiono i primi voli.

## File

| File | Ruolo |
|---|---|
| `snapshot.py` | Normalizza `raw.jsonl` / `raw_v2.jsonl`, `trips_data.json` e la pagina weekend in `snapshot.json` |
| `alerts.py` | Confronta lo snapshot con lo stato e invia il digest |
| `commands.py` | Comandi via `getUpdates`, deep link, pulsanti inline |
| `common.py` | Config, stato, client Telegram, formattazione, link alle pagine |
| `config.json` | Soglie di default, URL delle dashboard, username del bot, regole (nessun segreto) |
| `selftest.py` | Test completo senza rete |
| `state/prefs.json`, `state/offset.json` | Scritti da `commands.py` |
| `state/last_snapshot.json`, `state/notified.json`, `state/history.json` | Scritti da `alerts.py` (`history.json`: minimo giornaliero per meta, ultimi 90 giorni, serve al "prezzo tipico") |
| `workflows_draft/` | Bozze dei workflow, da spostare in `.github/workflows/` |

## Limiti da sapere

- **Tempi di risposta**: il workflow dei comandi parte ogni ~13 minuti e ascolta per 10. In quella finestra il bot risponde subito; nei minuti scoperti la risposta arriva al giro dopo. I cron di GitHub possono partire in ritardo di qualche minuto nelle ore di punta.
- **Repo inattivo**: GitHub sospende i workflow schedulati dopo 60 giorni senza commit. I commit giornalieri dello scan lo tengono attivo.
- **Popular trips open-jaw**: il prezzo è la somma di due solo-andata (stima del multi-city, come nella dashboard) più eventuali tratte stimate, indicate nel messaggio.
- **Avvisi in pausa**: chi è in pausa non riceve il digest di quel giro e non lo recupera dopo.
- **Cadenza**: gli avvisi arrivano con la cadenza dello scan, non in tempo reale.
- **Pulsanti delle card**: "Silenzia" e "Rimuovi preferito" sono letti dal workflow dei comandi, quindi la conferma arriva entro ~13 minuti.
- **Foto nelle card**: Telegram scarica la foto dall'URL pubblico del sito; finché il sito non è online (o `DASHBOARD_URL` non è impostata) le card sono solo testo.
- **Prezzo tipico**: nei primi 5 giorni di scansioni non c'è abbastanza storia e la riga "tipico" non compare.
