# agosto2027

Voli e trip per agosto 2027 da Milano, Roma, Pisa: 10-12 giorni, mete fuori Europa, prezzi di Google Flights riletti ogni notte.

Sito: https://cosimoney.github.io/agosto2027/

## Come gira

Tutto su GitHub Actions, senza server.

| Workflow | Quando | Cosa fa |
|---|---|---|
| `scan.yml` | ogni mattina, 05:23 UTC | scansione completa da zero, verifica dei vuoti, build, pubblicazione su Pages, avvisi Telegram |
| `deploy.yml` | push su grafica o cataloghi, o a mano | ricostruisce il sito dai dati dell'ultimo giro, senza riscansionare |
| `bot-commands.yml` | ogni ~13 minuti | legge i comandi del bot Telegram e salva preferiti e soglie |
| `bot-register.yml` | a mano | registra il menu dei comandi del bot |

`pipeline.py` orchestra il giro: `scan.py` e `scan_trips.py` (scansione), `verify.py` (ricontrollo delle pagine vuote), `build_trips.py`, `build.py`, `build_v2.py` (pagina), poi `bot/snapshot.py` e `bot/alerts.py`.

## Dati

- Branch `main`: codice, foto (`img/`) e stato del bot (`bot/state/`).
- Branch `data`: i dati dell'ultimo giro (`raw_v2.jsonl`, `trips_raw_v2.jsonl`, `trips_data.json`, `bot/snapshot.json`, `scan_meta.json`) in un solo commit, sovrascritto a ogni giro. Niente storico: il repo non cresce.
- Lo storico dei prezzi che serve al bot sta in `bot/state/history.json` (minimo giornaliero per meta, ultimi 90 giorni).
- Lo storico per il grafico "Il prezzo nel tempo" delle pagine meta e trip sta in `bot/state/price_history.json` (`price_history.py`): minimo per persona per giorno, totale e da Milano / Roma / Pisa. Lo aggiorna `pipeline.py build` a ogni giro riuscito, lo committa il workflow della scansione; un giro in ABORT non scrive nulla. Test: `python test_price_history.py`.
- Il sito viene pubblicato dall'action di Pages: `index.html` non è nel repo.

## Sito

- La pagina è leggera: i dati (mete, voli, foto, storico) stanno in `data.json`, che `build_v2.py` scrive accanto alla pagina e `v2.js` scarica all'avvio (`data.json?v=<hash>`). `python build_v2.py --inline` rimette tutto in un solo file, apribile da disco.
- Foto in più larghezze: `python photo_variants.py` crea `img/<nome>-480.webp`, `-800`, `-1200` dalle foto già presenti (da rilanciare dopo `photos.py`); la pagina le usa con `srcset`.
- Pagine: `#/voti` (voti da 0 a 5 di ciascuno, incrociati), `#/confronto` (2-3 mete o giri fianco a fianco), `#/mappa` (mete colorate per prezzo; contorno in `world.json`, rigenerabile con `python build_map.py`; coordinate in `dests.py`, `COORDS`).
- Badge «prezzo basso / tipico / alto»: ultimo giro contro la mediana dello storico, visibile da 5 giorni di dati per quella voce.
- Voti e preferiti passano dal Worker (`/api/rate`, `/api/rates`, `/api/fav`, `/api/favs`) con il link personale di `/sito`; nel bot c'è anche `/voti`.
- Test: `python build_v2.py && node test_v2.js`, `cd worker && npm test`.

## Protezioni

- Se Google blocca il runner le pagine tornano vuote: quando i risultati con voli scendono sotto il 60% del giro precedente il giro si ferma, il sito resta quello di prima e non parte nessun avviso.
- Mete senza A/R: la pagina di Google Flights che legge `gf.py` porta solo i risultati già pronti lato server; sulle rotte poco cercate arriva vuota e il browser carica i voli dopo, con `GetShoppingResults`. `estimate.py` interroga quella chiamata per le coppie aeroporto-meta rimaste vuote: prima i solo andata (veloci), la cui somma andata + ritorno compare sul sito e nel bot come "stima: somma di due solo andata"; poi l'A/R vero delle celle più economiche, che dove arriva sostituisce la stima. Tetto: `EST_BUDGET_MIN` (75 minuti).
- Se la scansione supera il tetto di tempo, le rotte non rifatte restano quelle del giro precedente e vengono rifatte per prime la notte dopo.
- Ogni giro fallito manda un messaggio Telegram all'amministratore.
- Token e chat stanno solo nei secret di Actions e del Worker.

## A mano

```bash
gh workflow run scan.yml                      # giro completo
gh workflow run scan.yml -f dry_run=true -f budget_min=3   # prova: non pubblica e non avvisa
gh workflow run deploy.yml                    # ripubblica il sito
```

Comandi del bot e preferiti del sito girano su un Worker Cloudflare (`worker/`, deploy con `bash worker/deploy.sh`).
Dettagli del bot in `bot/SETUP.md`. Foto: crediti e licenze in `img/credits.json`.
