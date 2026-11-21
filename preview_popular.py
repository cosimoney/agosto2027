# -*- coding: utf-8 -*-
"""Anteprima autonoma della tab Popular trips (popular-preview.html) senza toccare template.html:
prende <head> e <style> dal template, aggiunge popular_tab.css/js e i dati di trips_data.json."""
import re
tpl = open("template.html", encoding="utf-8").read()
head = tpl[:tpl.index("</style>")]
data = open("trips_data.json", encoding="utf-8").read().replace("</", "<" + chr(92) + "/")
html = (head + "\n" + open("popular_tab.css", encoding="utf-8").read() + "</style>\n"
        '<header class="board"><div class="board-inner"><p class="eyebrow">Anteprima &middot; Milano (LIN &middot; MXP) &middot; 2 adulti</p>'
        '<h1>Agosto 2027 da Milano</h1><div class="tabs" role="tablist"><button class="tab" role="tab" aria-selected="true">Popular trips<small id="tn-pop"></small></button></div></div></header>\n'
        '<main><section id="pop-root"></section></main>\n<script>\n' + open("popular_tab.js", encoding="utf-8").read() +
        '\nPopularTrips.mount(document.getElementById("pop-root"), ' + data + ', {countEl: document.getElementById("tn-pop")});\n</script>\n</html>\n')
open("popular-preview.html", "w", encoding="utf-8").write(html)
print("popular-preview.html", len(html), "bytes")
