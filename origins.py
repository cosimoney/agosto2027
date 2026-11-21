# -*- coding: utf-8 -*-
"""Aeroporti di partenza. Unica fonte per scan.py, scan_trips.py, verify.py, build.py, build_trips.py.
Si confrontano SOLO i prezzi dei voli: nessun costo di treno o posizionamento verso Roma o Pisa.

Gruppi: negli open-jaw si rientra su un aeroporto dello stesso gruppo dell'andata (Milano: LIN o MXP; Roma: FCO; Pisa: PSA).
Ciampino (CIA) escluso: il 21/11/2026 Google Flights non restituisce nessun volo da CIA per agosto 2027 verso nessuno degli
81 aeroporti del progetto (77 destinazioni + scali dei trip; A/R 7-18 agosto, fino a 2 scali), mentre a gennaio 2027 la stessa
ricerca trova CIA-Marrakech Ryanair: le low-cost di Ciampino non hanno ancora pubblicato l'estate 2027.
"""
ORIGINS = ["LIN", "MXP", "FCO", "PSA"]
HOME = ["LIN", "MXP"]
GROUP = {"LIN": "MIL", "MXP": "MIL", "FCO": "ROM", "PSA": "PSA"}
GROUPS = {"MIL": ["LIN", "MXP"], "ROM": ["FCO"], "PSA": ["PSA"]}
GROUP_NAME = {"MIL": "Milano", "ROM": "Roma", "PSA": "Pisa"}
INFO = {
    "LIN": {"name": "Milano LIN", "city": "Milano", "apt": "Linate", "group": "MIL"},
    "MXP": {"name": "Milano MXP", "city": "Milano", "apt": "Malpensa", "group": "MIL"},
    "FCO": {"name": "Roma FCO", "city": "Roma", "apt": "Fiumicino", "group": "ROM"},
    "PSA": {"name": "Pisa PSA", "city": "Pisa", "apt": "Galileo Galilei", "group": "PSA"},
}

def export():
    """Per i blob: RAW.meta.origins / RAW.meta.groups (e gli stessi campi in trips_data.json)."""
    return {"origins": [dict(INFO[o], code=o) for o in ORIGINS], "groups": GROUPS, "groupNames": GROUP_NAME, "home": HOME}
