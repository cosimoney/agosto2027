# -*- coding: utf-8 -*-
"""Foto per agosto-2027-v2.html: Wikimedia Commons -> img/*.webp + img/credits.json + img/manifest.json.

Solo licenze libere (CC0, CC BY, CC BY-SA, pubblico dominio). Preferenza: Featured picture > Quality image >
Valued image > ricerca semplice. Niente hotlink: tutto in locale.

  python photos.py            scarica cio' che manca
  python photos.py --redo k1 k2   riscarica le chiavi indicate (dopo aver cambiato SKIP / FILE / la query)
  python photos.py --sheet    fogli di controllo in screens/sheet-N.jpg
  python photos.py --stats    conteggi e peso

Modello: PHOTOS[chiave] = (query, didascalia, alias di tappa...). COVER[codice IATA] = chiave, GALLERY[codice] = [chiavi],
POPCOVER[id trip] = chiave. Le tappe degli itinerari trovano la foto per alias (nome tappa che contiene l'alias).
"""
import io, json, os, re, sys, time, html, unicodedata, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
UA = "TripDashboardBuilder/1.0 (static travel page; python-urllib)"
API = "https://commons.wikimedia.org/w/api.php"
TIERS = ["haswbstatement:P6731=Q63348049", "haswbstatement:P6731=Q63348069", "haswbstatement:P6731=Q63348040", ""]
BAD = re.compile(r"map|logo|flag|coat|locator|diagram|plan\b|stamp|banknote|satellit|\bISS\b|nasa|landsat|sentinel|chart|"
                 r"portrait|museum|painting|drawing|engraving|poster|sign\b|specimen|herbarium|skull|coin|interior|"
                 r"bird|trogon|vulture|bicy|delivery|starfish|sea.star|bierstadt|oil.on.canvas|butterfly|insect|flower|moth|beetle|frog|snake|lizard|macro|black.and.white|\bbw\b|1[89]\d\d|aerial.view.of.airport|airport|aircraft|airbus|boeing|locomotive|bus\b", re.I)
BADCAT = re.compile(r"paint|bierstadt|artwork|\bart\b|prints?\b|illustrat|engraving|drawing|lithograph|etching|watercolo|sketch|poster|postcard|"
                    r"\bmaps?\b|black.and.white|monochrome|histor(y|ical) (images|photographs)|old photographs|1[5-9]\d\d (paintings|works|photographs)|"
                    r"google art|museum collection|scans? from|book illustrations|coats of arms|\bflags?\b|\blogos?\b|diagrams|satellite pictures|"
                    r"photographs taken from (space|the iss)|featured pictures of (animals|birds|arthropods|insects|plants|fungi)", re.I)
LIC_OK = re.compile(r"^(cc0|cc[ -]by(-sa)?[ -]\d|public domain|pd\b|cc by-sa|cc by )", re.I)

PHOTOS = {}
def P(key, query, cap, *alias):
    PHOTOS[key] = (query if isinstance(query, list) else [query], cap, list(alias))

# ---------------------------------------------------------------- Asia
P("bali", ["Jatiluwih rice terraces", "Tegallalang rice terrace"], "Risaie di Bali", "Ubud")
P("nusa-penida", "Kelingking Beach", "Nusa Penida", "Nusa Penida")
P("uluwatu", ["Uluwatu Temple", "Pura Luhur Uluwatu"], "Uluwatu", "Uluwatu")
P("bromo", ["Mount Bromo sunrise", "Bromo Tengger Semeru"], "Bromo, Giava Est", "Bromo")
P("munduk", ["Pura Ulun Danu Bratan", "Munduk Bali"], "Lago Bratan, Munduk", "Munduk")
P("rinjani", ["Mount Rinjani Segara Anak", "Rinjani"], "Rinjani, Lombok", "Rinjani", "Senaru", "Sembalun")
P("gili", ["Gili Trawangan", "Gili Air", "Gili Meno"], "Isole Gili", "Gili")
P("komodo", ["Padar Island", "Komodo National Park"], "Padar, Komodo", "Komodo", "Labuan Bajo")
P("sigiriya", ["Sigiriya rock", "Sigiriya"], "Sigiriya", "Sigiriya")
P("kandy", ["Temple of the Tooth Kandy", "Kandy Lake"], "Kandy", "Kandy")
P("ella", ["Nine Arch Bridge Ella", "Ella Sri Lanka"], "Ella", "Ella")
P("nuwara-eliya", ["Nuwara Eliya tea plantation", "tea plantation Sri Lanka"], "Piantagioni di tè", "Nuwara Eliya")
P("trincomalee", ["Trincomalee beach", "Nilaveli beach", "Trincomalee"], "Trincomalee", "Trincomalee", "Passikudah", "Pasikudah", "Arugam")
P("kuala-lumpur", ["Kuala Lumpur skyline Petronas", "Petronas Towers"], "Kuala Lumpur", "Kuala Lumpur")
P("penang", ["George Town Penang street", "Kek Lok Si"], "George Town, Penang", "Penang")
P("cameron", ["Cameron Highlands tea plantation", "Cameron Highlands"], "Cameron Highlands", "Cameron Highlands")
P("perhentian", ["Perhentian Islands beach", "Pulau Perhentian"], "Isole Perhentian", "Perhentian")
P("kinabatangan", ["Kinabatangan River", "Proboscis monkey Sabah"], "Fiume Kinabatangan", "Kinabatangan")
P("sepilok", ["Sepilok orangutan", "Bornean orangutan Sabah"], "Oranghi a Sepilok", "Sepilok")
P("kinabalu", ["Mount Kinabalu", "Kinabalu summit"], "Monte Kinabalu", "Kota Kinabalu")
P("tioman", ["Tioman Island beach", "Pulau Tioman"], "Tioman", "Tioman")
P("mongolia", ["Mongolia steppe yurt", "Mongolian ger steppe", "Orkhon Valley"], "Steppa mongola", "Orkhon", "Kharkhorin")
P("khongor", ["Khongoryn Els", "Gobi desert dunes Mongolia"], "Dune di Khongor, Gobi", "Gobi", "Khongor")
P("song-kul", ["Song-Kul lake yurt", "Song Köl", "Son-Kul"], "Lago Song-Kul", "Song-Kul")
P("issyk-kul", ["Jeti-Oguz", "Skazka canyon Issyk-Kul", "Issyk-Kul"], "Issyk-Kul", "Issyk-Kul", "Karakol", "Bokonbayevo")
P("almaty", ["Big Almaty Lake", "Almaty mountains"], "Lago Grande di Almaty", "Almaty")
P("charyn", ["Charyn Canyon", "Kolsai Lakes"], "Canyon di Charyn", "Charyn", "Kolsai")
P("tbilisi", ["Tbilisi old town Narikala", "Tbilisi panorama"], "Tbilisi", "Tbilisi")
P("gergeti", ["Gergeti Trinity Church", "Kazbegi Gergeti"], "Gergeti, Kazbegi", "Kazbegi")
P("ushguli", ["Ushguli", "Svaneti towers"], "Ushguli, Svaneti", "Ushguli", "Trek Zhabeshi")
P("mestia", ["Mestia", "Svan towers Mestia"], "Mestia", "Mestia")
P("sighnaghi", ["Sighnaghi", "Signagi Kakheti", "Alazani valley"], "Sighnaghi, Kakheti", "Signagi", "Sighnaghi", "Kakheti")
P("kutaisi", ["Gelati Monastery", "Kutaisi"], "Gelati, Kutaisi", "Kutaisi")
P("khor-virap", ["Khor Virap Ararat", "Khor Virap"], "Khor Virap e Ararat", "Erevan")
P("dilijan", ["Haghartsin Monastery", "Dilijan National Park"], "Haghartsin, Dilijan", "Dilijan")
P("sevan", ["Sevanavank", "Lake Sevan"], "Lago Sevan", "Sevan")
P("tatev", ["Tatev Monastery", "Tatev"], "Tatev", "Goris")
P("haghpat", ["Haghpat Monastery", "Sanahin Monastery"], "Haghpat", "Haghpat", "Alaverdi")
P("noravank", ["Noravank", "Noravank monastery"], "Noravank", "Yeghegnadzor")
P("biei", ["Biei Hokkaido blue pond", "Furano lavender", "Biei hills"], "Biei, Hokkaido", "Biei", "Furano")
P("shiretoko", ["Shiretoko Five Lakes", "Shiretoko National Park"], "Shiretoko", "Shiretoko")
P("asahidake", ["Asahidake", "Daisetsuzan National Park"], "Asahidake, Daisetsuzan", "Asahidake", "Daisetsuzan")
P("otaru", ["Otaru canal", "Otaru"], "Otaru", "Otaru")
P("okinawa", ["Kerama Islands beach", "Okinawa beach"], "Isole Kerama, Okinawa")
P("nachi", ["Nachi Falls Seiganto-ji", "Nachi Falls"], "Cascata di Nachi", "Nachi")
P("koyasan", ["Okunoin Koyasan", "Mount Koya"], "Koya-san", "Koya-san")
P("kumano", ["Kumano Kodo", "Kumano Hongu Taisha"], "Kumano Kodo", "Kumano Kodo", "Yunomine")
P("nara", ["Todai-ji Nara", "Nara Park deer"], "Nara", "Nara")
P("iya", ["Iya Valley vine bridge", "Iya Valley"], "Valle di Iya", "Iya")
P("osaka", ["Osaka Castle", "Dotonbori"], "Osaka", "Osaka")
P("shimanami", ["Shimanami Kaido", "Tatara Bridge"], "Shimanami Kaido", "Shimanami")
P("kamikochi", ["Kamikochi Kappa Bridge", "Kamikochi"], "Kamikochi", "Kamikochi")
P("shirakawa", ["Shirakawa-go", "Ogimachi gassho"], "Shirakawa-go", "Shirakawa")
P("takayama", ["Takayama old town Sanmachi", "Takayama Gifu"], "Takayama", "Takayama")
P("matsumoto", ["Matsumoto Castle"], "Castello di Matsumoto", "Matsumoto")
P("kanazawa", ["Kenroku-en", "Kanazawa Higashi Chaya"], "Kenroku-en, Kanazawa", "Kanazawa")
P("tateyama", ["Tateyama Murodo Mikurigaike", "Tateyama Kurobe Alpine Route"], "Murodo, Tateyama", "Murodo", "Tateyama")
P("tokyo", ["Tokyo skyline Mount Fuji", "Shibuya crossing", "Tokyo skyline"], "Tokyo", "Tokyo")
P("aso", ["Mount Aso caldera", "Aso Kusasenri"], "Monte Aso, Kyushu", "Aso")
P("ladakh", ["Thiksey Monastery", "Pangong Tso", "Ladakh landscape"], "Ladakh", "Leh", "Thiksey")
P("delhi", ["Humayun's Tomb", "Jama Masjid Delhi"], "Delhi", "Delhi")
P("samui", ["Ang Thong National Marine Park", "Koh Samui beach"], "Ang Thong, Koh Samui", "Samui")
P("bangkok", ["Wat Arun", "Bangkok skyline"], "Bangkok", "Bangkok")
P("petra", ["Petra Treasury Al-Khazneh", "Petra Monastery"], "Petra")
P("dubai", ["Dubai skyline Burj Khalifa", "Dubai Marina"], "Dubai")
P("palawan", ["El Nido Palawan", "Coron Palawan"], "Palawan")
P("singapore", ["Marina Bay Singapore skyline", "Gardens by the Bay"], "Singapore", "Singapore")
P("ijen", ["Kawah Ijen crater", "Ijen"], "Kawah Ijen", "Ijen")
P("toba", ["Lake Toba Samosir", "Lake Toba"], "Lago Toba", "Toba")
P("borobudur", ["Borobudur sunrise", "Borobudur"], "Borobudur", "Yogyakarta")
P("bukit-lawang", ["Sumatran orangutan Bukit Lawang", "Sumatran orangutan Gunung Leuser"], "Bukit Lawang", "Bukit Lawang")
P("cappadocia", ["Cappadocia balloons Göreme", "Göreme hot air balloons"], "Cappadocia", "Göreme", "Goreme")
P("nemrut", ["Mount Nemrut statues", "Nemrut Dağı"], "Nemrut Dağı", "Nemrut")
P("mardin", ["Mardin old city", "Mardin"], "Mardin", "Mardin")
P("ihlara", ["Ihlara Valley", "Selime Monastery"], "Valle di Ihlara", "Ihlara")
P("ishak-pasha", ["Ishak Pasha Palace", "Mount Ararat Doğubayazıt"], "Palazzo di Ishak Pasha", "Doğubayazıt")
P("akdamar", ["Akdamar Island church", "Lake Van"], "Akdamar, lago di Van", "Van")
P("sumela", ["Sumela Monastery", "Uzungöl"], "Monastero di Sumela", "Trabzon", "Sumela")
# Cina dell'ovest e del nord (23 novembre 2026)
P("kanas", ["Kanas Lake", "Hemu Village Xinjiang"], "Lago Kanas, Xinjiang", "Kanas", "Hemu", "Burqin")
P("sayram", ["Sayram Lake", "Sailimu Lake"], "Lago Sayram", "Sayram")
P("nalati", ["Nalati grassland", "Kalajun grassland", "Ili grassland Xinjiang"], "Praterie dell'Ili", "Nalati", "Tekes", "Yining")
P("tianchi", ["Tianchi Tianshan Xinjiang", "Heavenly Lake of Tianshan"], "Lago Tianchi, Tianshan", "Urumqi")
P("turpan", ["Jiaohe ruins", "Flaming Mountains Turpan"], "Rovine di Jiaohe, Turpan", "Turpan")
P("kashgar", ["Kashgar old city", "Id Kah Mosque"], "Kashgar", "Kashgar")
P("karakul", ["Muztagh Ata", "Karakul Lake Kashgar", "Karakul Lake Xinjiang"], "Lago Karakul e Muztagh Ata", "Karakul", "Tashkurgan")
P("qinghai-lake", ["Qinghai Lake", "Koko Nor Qinghai"], "Lago Qinghai", "Lago Qinghai")
P("chaka", ["Chaka Salt Lake", "Caka Salt Lake"], "Salina di Chaka", "Chaka")
P("zhangye", ["Zhangye Danxia", "Zhangye National Geopark"], "Danxia di Zhangye", "Zhangye")
P("dunhuang", ["Crescent Lake Dunhuang", "Mingsha Shan Dunhuang", "Dunhuang dunes"], "Dune di Mingsha, Dunhuang", "Dunhuang")
P("jiayuguan", ["Jiayuguan Fort", "Jiayu Pass"], "Forte di Jiayuguan", "Jiayuguan")
P("labrang", ["Labrang Monastery", "Xiahe Labrang"], "Monastero di Labrang", "Labrang")
P("lanzhou", ["Zhongshan Bridge Lanzhou", "Lanzhou Yellow River"], "Lanzhou e il Fiume Giallo", "Lanzhou")
P("potala", ["Potala Palace", "Potala Lhasa"], "Potala, Lhasa", "Lhasa")
P("yamdrok", ["Yamdrok Lake", "Yamdrok Tso"], "Lago Yamdrok", "Gyantse", "Shigatse")
P("everest-nord", ["Rongbuk Monastery Everest", "Everest north face Tibet"], "Everest da Rongbuk", "Everest", "Rongbuk")
P("siguniang", ["Siguniang Mountain", "Four Sisters Mountain Sichuan", "Mount Siguniang", "Siguniangshan"], "Monte Siguniang", "Siguniang")
P("danba", ["Danba Tibetan village", "Jiaju Tibetan village", "Danba Sichuan"], "Villaggi tibetani di Danba", "Danba")
P("tagong", ["Tagong grassland", "Tagong Sichuan", "Yala Snow Mountain"], "Prateria di Tagong", "Tagong", "Xinduqiao")
P("yading", ["Yading", "Daocheng Yading", "Yading Nature Reserve"], "Yading", "Yading")
P("jiuzhaigou", ["Jiuzhaigou Five Flower Lake", "Jiuzhaigou Valley"], "Jiuzhaigou", "Jiuzhaigou")
P("chengdu", ["Chengdu Research Base of Giant Panda Breeding", "giant panda Chengdu"], "Panda a Chengdu", "Chengdu")
P("hulunbuir", ["Hulunbuir grassland", "Hulun Buir grassland", "Ergun wetland"], "Prateria di Hulunbuir", "Hailar", "Ergun", "Enhe", "Shiwei", "Heishantou", "Manzhouli", "Genhe")
P("grande-muraglia", ["Jinshanling Great Wall", "Mutianyu Great Wall"], "Grande Muraglia a Jinshanling", "Grande Muraglia", "Gubeikou")
P("pechino", ["Forbidden City Beijing", "Temple of Heaven Beijing"], "Città Proibita, Pechino", "Pechino")
# Secondo giro del 23 novembre 2026: Pamir, Karakorum, Indonesia orientale, Caucaso, Africa australe, isole atlantiche, Ande, Pantanal, Oaxaca, Guatemala, Europa remota
P("pamir", ["Pamir Highway", "Wakhan Corridor Tajikistan", "Pamir Mountains Tajikistan"], "Pamir Highway", "Khorog", "Murghab", "Langar", "Kalaikhum", "Bulunkul", "Karakul (Pamir)", "Sary-Mogol")
P("iskanderkul", ["Iskanderkul", "Fann Mountains"], "Lago Iskanderkul, monti Fann", "Iskanderkul", "Alauddin", "Penjikent")
P("hunza", ["Passu Cones", "Hunza Valley", "Karimabad Hunza"], "Coni di Passu, Hunza", "Karimabad", "Passu", "Gilgit")
P("fairy-meadows", ["Fairy Meadows Nanga Parbat", "Fairy Meadows"], "Nanga Parbat da Fairy Meadows", "Fairy Meadows")
P("skardu", ["Deosai National Park", "Shangrila Lake Skardu", "Skardu valley"], "Altopiano del Deosai", "Skardu", "Deosai", "Khaplu", "Shigar")
P("kelimutu", ["Kelimutu", "Kelimutu crater lakes"], "Laghi del Kelimutu, Flores", "Kelimutu", "Ende")
P("wae-rebo", ["Wae Rebo", "Bena village Flores"], "Wae Rebo, Flores", "Wae Rebo", "Ruteng", "Bajawa")
P("toraja", ["Tongkonan Tana Toraja", "Kete Kesu", "Tana Toraja"], "Case tongkonan, Tana Toraja", "Rantepao")
P("bunaken", ["Bunaken", "Bunaken National Park"], "Bunaken", "Bunaken", "Manado")
P("togean", ["Togian Islands", "Togean Islands"], "Isole Togean", "Togean", "Ampana")
P("raja-ampat", ["Piaynemo Raja Ampat", "Raja Ampat islands", "Wayag"], "Piaynemo, Raja Ampat", "Mansuar", "Arborek", "Sorong", "Birie")
P("baku", ["Baku Flame Towers", "Baku old city", "Maiden Tower Baku"], "Baku", "Baku")
P("sheki", ["Palace of Shaki Khans", "Sheki Azerbaijan", "Shaki caravanserai"], "Palazzo dei Khan, Sheki", "Sheki", "Lahij")
P("khinalug", ["Khinalug", "Xinaliq", "Quba Azerbaijan mountains"], "Khinalug, Caucaso alto", "Khinalug", "Quba")
P("bazaruto", ["Bazaruto Archipelago", "Bazaruto Island", "Vilankulo"], "Arcipelago di Bazaruto", "Vilanculos", "Bazaruto")
P("tofo", ["Tofo beach Mozambique", "Praia do Tofo", "Inhambane"], "Tofo", "Tofo")
P("maputo", ["Maputo skyline", "Maputo railway station", "Maputo city"], "Maputo", "Maputo")
P("south-luangwa", ["South Luangwa National Park", "Luangwa River"], "South Luangwa", "South Luangwa")
P("lower-zambezi", ["Lower Zambezi National Park", "Zambezi River canoe", "Zambezi River Zambia"], "Lower Zambezi", "Lower Zambezi", "Lusaka")
P("lake-malawi", ["Cape Maclear Lake Malawi", "Lake Malawi", "Likoma Island"], "Lago Malawi", "Lago Malawi", "Cape Maclear", "Mumbo")
P("liwonde", ["Liwonde National Park", "Shire River Malawi"], "Liwonde", "Liwonde", "Majete")
P("sal", ["Santa Maria Sal Cape Verde", "Pedra de Lume", "Sal Cape Verde beach"], "Sal, Capo Verde", "Santa Maria")
P("boa-vista", ["Boa Vista Cape Verde", "Deserto de Viana", "Praia de Santa Monica Boa Vista"], "Boa Vista", "Boa Vista")
P("fogo", ["Pico do Fogo", "Chã das Caldeiras"], "Pico do Fogo", "Fogo")
P("cidade-velha", ["Cidade Velha", "Santiago Cape Verde"], "Cidade Velha, Santiago", "Santiago (Praia)")
P("santo-antao", ["Santo Antão Cape Verde", "Paul valley Santo Antão", "Ribeira Grande Santo Antão"], "Santo Antão", "Santo Antão")
P("mindelo", ["Mindelo", "Mindelo São Vicente"], "Mindelo, São Vicente", "Mindelo")
P("sao-tome", ["Pico Cão Grande", "São Tomé island", "São Tomé beach"], "Pico Cão Grande, São Tomé", "São Tomé", "Monte Café")
P("principe", ["Príncipe island", "Praia Banana Príncipe", "Principe Island beach"], "Príncipe", "Príncipe")
P("purmamarca", ["Purmamarca", "Salinas Grandes Jujuy"], "Purmamarca", "Purmamarca", "Iruya")
P("tolar-grande", ["Tolar Grande", "Cono de Arita", "Puna de Atacama Salta"], "Puna di Tolar Grande", "Tolar Grande")
P("tatio", ["El Tatio geysers", "El Tatio"], "Geyser del Tatio", "Tatio")
P("bonito", ["Gruta do Lago Azul", "Rio da Prata Bonito", "Bonito Mato Grosso do Sul"], "Gruta do Lago Azul, Bonito", "Bonito")
P("chapada-guimaraes", ["Chapada dos Guimarães", "Véu de Noiva Chapada dos Guimarães"], "Chapada dos Guimarães", "Chapada dos Guimarães", "Nobres")
P("oaxaca", ["Monte Albán", "Santo Domingo Oaxaca"], "Monte Albán, Oaxaca", "Oaxaca")
P("hierve", ["Hierve el Agua"], "Hierve el Agua", "Sierra Norte")
P("puebla", ["Cholula pyramid Popocatépetl", "Puebla cathedral"], "Cholula e Popocatépetl", "Puebla")
P("antigua", ["Antigua Guatemala Arco de Santa Catalina", "Antigua Guatemala"], "Antigua", "Antigua")
P("atitlan", ["Lake Atitlán", "Lago de Atitlán"], "Lago Atitlán", "Atitlán", "Quetzaltenango")
P("tikal", ["Tikal", "Tikal Temple"], "Tikal", "Tikal")
P("jokulsarlon", ["Jökulsárlón", "Jokulsarlon glacier lagoon"], "Laguna di Jökulsárlón", "Höfn", "Skaftafell")
P("landmannalaugar", ["Landmannalaugar"], "Landmannalaugar", "Landmannalaugar")
P("skogafoss", ["Skógafoss", "Seljalandsfoss"], "Skógafoss", "Hella")
P("myvatn", ["Mývatn", "Goðafoss", "Dettifoss"], "Mývatn", "Mývatn", "Akureyri")
P("kirkjufell", ["Kirkjufell"], "Kirkjufell, Snæfellsnes", "Snæfellsnes")
P("sete-cidades", ["Sete Cidades", "Lagoa das Sete Cidades"], "Sete Cidades, São Miguel", "São Miguel")
P("pico", ["Mount Pico Azores", "Montanha do Pico", "Pico Island"], "Vulcano Pico", "Pico")
P("faial", ["Capelinhos", "Horta Faial", "Caldeira Faial"], "Capelinhos, Faial", "Faial")
P("terceira", ["Angra do Heroísmo", "Terceira Island"], "Angra do Heroísmo, Terceira", "Terceira")
P("azores-flores", ["Poço da Ribeira do Ferreiro", "Flores Island Azores"], "Cascate di Flores, Azzorre")
P("madeira", ["Pico do Arieiro", "Pico Ruivo", "Pico do Areeiro Madeira"], "Pico do Areeiro, Madeira", "Santana", "Machico")
P("levada", ["Levada das 25 Fontes", "Levada do Caldeirão Verde", "Levada Madeira"], "Levada, Madeira", "Calheta")
P("funchal", ["Funchal", "Funchal bay"], "Funchal", "Funchal")
P("porto-santo", ["Porto Santo beach", "Porto Santo Island"], "Porto Santo", "Porto Santo")
P("faroe", ["Múlafossur", "Gásadalur", "Sørvágsvatn"], "Múlafossur, Vágar", "Vágar")
P("kalsoy", ["Kallur lighthouse", "Kalsoy", "Klaksvík"], "Faro di Kallur, Kalsoy", "Klaksvík")
P("gjogv", ["Gjógv", "Saksun"], "Gjógv, Eysturoy", "Gjógv", "Tórshavn")
P("reine", ["Reine Lofoten", "Reinebringen", "Hamnøy"], "Reine, Lofoten", "Reine")
P("henningsvaer", ["Henningsvær", "Svolvær", "Haukland beach"], "Henningsvær, Lofoten", "Henningsvær", "Svolvær", "Leknes")
P("senja", ["Senja Segla", "Senja Norway", "Bergsbotn"], "Senja", "Senja", "Andenes")
P("tromso", ["Tromsø", "Tromsø Arctic Cathedral"], "Tromsø", "Tromsø")
P("svalbard", ["Longyearbyen", "Svalbard glacier", "Nordenskiöldbreen"], "Longyearbyen, Svalbard", "Longyearbyen")
P("ilulissat", ["Ilulissat Icefjord", "Ilulissat"], "Fiordo dei ghiacci, Ilulissat", "Ilulissat", "Eqi", "Ilimanaq")
P("nuuk", ["Nuuk", "Nuuk Sermitsiaq"], "Nuuk", "Nuuk")
P("disko", ["Qeqertarsuaq", "Disko Island", "Disko Bay"], "Isola di Disko", "Qeqertarsuaq")
# ---------------------------------------------------------------- Oceania
P("barrier-reef", ["Great Barrier Reef aerial", "Whitehaven Beach"], "Grande Barriera Corallina", "Cairns", "Whitsunday")
P("kakadu", ["Kakadu National Park", "Ubirr Kakadu"], "Kakadu", "Kakadu")
P("pinnacles", ["Pinnacles Nambung National Park", "Karijini National Park"], "Pinnacles, Western Australia")
P("auckland", ["Auckland skyline", "Piha beach"], "Auckland", "Auckland")
P("queenstown", ["Queenstown Lake Wakatipu", "Milford Sound"], "Queenstown", "Queenstown")
P("moorea", ["Moorea lagoon", "Bora Bora lagoon"], "Moorea, Polinesia", "Moorea")
P("fiji", ["Fiji island beach Mamanuca", "Yasawa Islands"], "Fiji")
# ---------------------------------------------------------------- Africa
P("masai-mara", ["Maasai Mara wildebeest migration", "Maasai Mara savanna"], "Masai Mara", "Masai Mara")
P("diani", ["Diani Beach", "Watamu beach"], "Diani Beach", "Diani", "Watamu")
P("amboseli", ["Amboseli elephants Kilimanjaro", "Amboseli National Park"], "Amboseli", "Amboseli")
P("tsavo", ["Tsavo East elephants", "Tsavo National Park"], "Tsavo", "Tsavo")
P("lamu", ["Lamu dhow", "Lamu Old Town", "Shela Lamu"], "Lamu", "Lamu")
P("naivasha", ["Lake Naivasha", "Hell's Gate National Park"], "Lago Naivasha", "Naivasha")
P("kilimanjaro", ["Mount Kilimanjaro", "Kilimanjaro Kibo"], "Kilimangiaro", "Arusha")
P("zanzibar", ["Zanzibar beach dhow", "Zanzibar beach", "Paje beach"], "Zanzibar", "Paje", "Matemwe", "Kendwa", "Zanzibar")
P("stone-town", ["Stone Town Zanzibar", "Stone Town"], "Stone Town", "Stone Town")
P("nungwi", ["Nungwi beach", "Nungwi"], "Nungwi", "Nungwi")
P("serengeti", ["Serengeti National Park lions", "Serengeti"], "Serengeti", "Serengeti")
P("ngorongoro", ["Ngorongoro Crater", "Ngorongoro"], "Cratere di Ngorongoro", "Ngorongoro")
P("tarangire", ["Tarangire National Park baobab elephants", "Tarangire"], "Tarangire", "Tarangire")
P("volcanoes", ["Mountain gorilla Volcanoes National Park", "Virunga Mountains Rwanda"], "Parco dei Vulcani, Rwanda", "Kigali", "Volcanoes")
P("bwindi", ["Mountain gorilla Bwindi", "Bwindi Impenetrable National Park"], "Gorilla a Bwindi", "Bwindi")
P("bunyonyi", ["Lake Bunyonyi"], "Lago Bunyonyi", "Bunyonyi")
P("kibale", ["Chimpanzee Kibale", "Queen Elizabeth National Park Uganda"], "Kibale", "Kibale", "Queen Elizabeth")
P("sossusvlei", ["Sossusvlei dunes", "Dune 45"], "Sossusvlei", "Sossusvlei", "Sesriem")
P("deadvlei", ["Deadvlei"], "Deadvlei")
P("etosha", ["Etosha waterhole", "Etosha National Park"], "Etosha", "Etosha")
P("swakopmund", ["Swakopmund", "Sandwich Harbour Namibia"], "Swakopmund", "Swakopmund")
P("damaraland", ["Spitzkoppe", "Damaraland landscape", "Twyfelfontein"], "Damaraland", "Damaraland")
P("fish-river", ["Fish River Canyon"], "Fish River Canyon", "Fish River")
P("kolmanskop", ["Kolmanskop"], "Kolmanskop, Lüderitz", "Lüderitz")
P("epupa", ["Epupa Falls"], "Epupa Falls", "Epupa")
P("okavango", ["Okavango Delta aerial", "Okavango Delta mokoro"], "Delta dell'Okavango", "Okavango", "Maun", "Moremi")
P("chobe", ["Chobe National Park elephants", "Chobe River"], "Chobe", "Chobe", "Savuti")
P("victoria-falls", ["Victoria Falls", "Mosi-oa-Tunya"], "Cascate Vittoria", "Victoria Falls")
P("baobab", ["Avenue of the Baobabs", "Allée des baobabs"], "Viale dei Baobab", "Morondava")
P("isalo", ["Isalo National Park", "Isalo"], "Isalo", "Isalo")
P("andasibe", ["Indri Andasibe", "Andasibe-Mantadia"], "Andasibe", "Andasibe")
P("nosy-be", ["Nosy Iranja", "Nosy Be beach"], "Nosy Be", "Nosy Be")
P("le-morne", ["Le Morne Brabant", "Le Morne Mauritius"], "Le Morne Brabant", "Le Morne")
P("chamarel", ["Chamarel Seven Coloured Earths", "Chamarel waterfall"], "Chamarel")
P("blue-bay", ["Blue Bay Mauritius", "Ile aux Cerfs", "Mahebourg"], "Blue Bay", "Mahébourg", "Blue Bay")
P("grand-baie", ["Trou aux Biches beach", "Grand Baie Mauritius", "Mauritius beach"], "Costa nord, Mauritius", "Grand Baie", "Flic en Flac", "Mauritius nord")
P("rodrigues", ["Rodrigues island lagoon", "Rodrigues island"], "Rodrigues", "Rodrigues")
P("seychelles", ["Anse Source d'Argent", "La Digue beach"], "Anse Source d'Argent, La Digue")
P("mafate", ["Cirque de Mafate", "Maïdo Mafate"], "Cirque de Mafate", "Mafate", "Saint-Gilles")
P("fournaise", ["Piton de la Fournaise", "Plaine des Sables"], "Piton de la Fournaise", "Fournaise", "Bourg-Murat")
P("cilaos", ["Cirque de Cilaos", "Cilaos"], "Cilaos", "Cilaos")
P("cape-town", ["Cape Town Table Mountain", "Table Mountain from Bloubergstrand"], "Città del Capo", "Cape Town", "Città del Capo")
P("cederberg", ["Cederberg Wolfberg", "Cederberg mountains"], "Cederberg", "Cederberg")
P("namaqualand", ["Namaqualand flowers", "Namaqua National Park"], "Fioritura del Namaqualand", "Namaqualand")
P("hermanus", ["Hermanus coast whale", "Hermanus"], "Hermanus", "Hermanus")
P("franschhoek", ["Franschhoek valley vineyards", "Stellenbosch vineyards"], "Franschhoek", "Franschhoek")
P("de-hoop", ["De Hoop Nature Reserve"], "De Hoop", "De Hoop")
P("blyde", ["Blyde River Canyon Three Rondavels", "Blyde River Canyon"], "Blyde River Canyon", "Blyde", "Graskop", "Panorama Route")
P("kruger", ["Kruger National Park elephants", "Kruger National Park"], "Kruger", "Kruger")
P("sabi-sand", ["Leopard Sabi Sand", "Leopard Kruger"], "Sabi Sand", "Sabi Sand")
P("eswatini", ["Mlilwane Wildlife Sanctuary", "Eswatini landscape", "Swaziland landscape"], "Eswatini", "Eswatini")
P("johannesburg", ["Johannesburg skyline"], "Johannesburg", "Johannesburg")
P("tsitsikamma", ["Tsitsikamma Storms River mouth", "Garden Route coast"], "Tsitsikamma, Garden Route", "Tsitsikamma", "Wilderness")
P("drakensberg", ["Drakensberg Amphitheatre", "Drakensberg"], "Drakensberg", "Drakensberg")
P("addo", ["Addo Elephant National Park"], "Addo Elephant Park", "Addo")
P("taghazout", ["Taghazout", "Agadir beach"], "Taghazout", "Taghazout", "Agadir")
P("essaouira", ["Essaouira ramparts", "Essaouira"], "Essaouira", "Essaouira")
P("imsouane", ["Imsouane", "Oualidia lagoon"], "Imsouane", "Imsouane", "Oualidia")
P("tafraoute", ["Tafraoute", "Ameln valley"], "Tafraoute", "Tafraoute")
P("legzira", ["Legzira beach arch", "Sidi Ifni"], "Legzira", "Sidi Ifni", "Mirleft")
# ---------------------------------------------------------------- Americhe
P("lima", ["Lima Miraflores coast", "Lima Plaza Mayor"], "Lima", "Lima")
P("machu-picchu", ["Machu Picchu"], "Machu Picchu", "Aguas Calientes", "Machu Picchu")
P("cusco", ["Cusco Plaza de Armas", "Cusco"], "Cusco", "Cusco")
P("sacred-valley", ["Ollantaytambo", "Moray Peru", "Sacred Valley Peru"], "Valle Sacra", "Valle Sacra")
P("huacachina", ["Huacachina"], "Huacachina", "Huacachina", "Paracas")
P("huaraz", ["Laguna 69", "Cordillera Blanca", "Alpamayo"], "Cordillera Blanca", "Huaraz", "Santa Cruz")
P("colca", ["Colca Canyon condor", "Colca Canyon"], "Canyon del Colca", "Colca")
P("arequipa", ["Arequipa Misti", "Santa Catalina Arequipa"], "Arequipa", "Arequipa")
P("titicaca", ["Lake Titicaca Uros", "Isla del Sol Titicaca", "Lake Titicaca"], "Lago Titicaca", "Titicaca", "Isla del Sol")
P("la-paz", ["La Paz Illimani", "La Paz Bolivia"], "La Paz", "La Paz")
P("uyuni", ["Salar de Uyuni"], "Salar de Uyuni", "Uyuni")
P("atacama", ["Valle de la Luna Atacama", "San Pedro de Atacama"], "Valle de la Luna, Atacama", "San Pedro de Atacama")
P("lagunas", ["Laguna Colorada", "Laguna Verde Bolivia"], "Laguna Colorada", "Traversata lagune")
P("valparaiso", ["Valparaíso cerros", "Valparaíso"], "Valparaíso", "Valparaíso")
P("santiago", ["Santiago de Chile skyline Andes", "Santiago Chile"], "Santiago", "Santiago")
P("buenos-aires", ["Buenos Aires Caminito", "Buenos Aires Obelisco", "Buenos Aires"], "Buenos Aires", "Buenos Aires")
P("iguazu", ["Iguazu Falls", "Cataratas del Iguazú"], "Cascate di Iguazú", "Iguazú", "Iguazu")
P("humahuaca", ["Serranía de Hornocal", "Cerro de los Siete Colores", "Quebrada de Humahuaca"], "Quebrada de Humahuaca", "Tilcara", "Humahuaca")
P("cafayate", ["Quebrada de las Conchas", "Cafayate"], "Quebrada de las Conchas", "Cafayate")
P("salta", ["Salta Argentina cathedral", "Salinas Grandes"], "Salta", "Salta", "Cachi")
P("peninsula-valdes", ["Southern right whale Península Valdés", "Península Valdés"], "Península Valdés", "Puerto Pirámides")
P("bariloche", ["Nahuel Huapi Bariloche", "Bariloche"], "Bariloche", "Bariloche")
P("llao-llao", ["Llao Llao", "Circuito Chico Bariloche", "Lago Espejo"], "Sette Laghi", "Villa La Angostura", "Siete Lagos")
P("cotopaxi", ["Cotopaxi volcano", "Cotopaxi"], "Cotopaxi", "Cotopaxi", "Quito")
P("quilotoa", ["Quilotoa"], "Laguna di Quilotoa", "Quilotoa")
P("galapagos", ["Bartolomé Island Galápagos", "Galápagos Pinnacle Rock"], "Galápagos", "Santa Cruz", "Isabela", "Galápagos")
P("rio", ["Rio de Janeiro Sugarloaf", "Rio de Janeiro Corcovado view"], "Rio de Janeiro", "Rio de Janeiro")
P("ilha-grande", ["Ilha Grande Lopes Mendes", "Ilha Grande"], "Ilha Grande", "Ilha Grande")
P("paraty", ["Paraty historic centre", "Paraty"], "Paraty", "Paraty")
P("ouro-preto", ["Ouro Preto"], "Ouro Preto", "Ouro Preto", "Tiradentes")
P("pantanal", ["Jaguar Pantanal", "Pantanal"], "Pantanal", "Porto Jofre", "Transpantaneira")
P("salvador", ["Pelourinho Salvador", "Salvador Bahia"], "Pelourinho, Salvador", "Salvador")
P("lencois", ["Lençóis Maranhenses"], "Lençóis Maranhenses", "Barreirinhas", "Atins", "Santo Amaro")
P("jericoacoara", ["Jericoacoara", "Pedra Furada Jericoacoara"], "Jericoacoara", "Jericoacoara")
P("arenal", ["Arenal Volcano", "Monteverde cloud forest"], "Vulcano Arenal", "Fortuna", "Arenal")
P("guanacaste", ["Guanacaste beach", "Playa Conchal"], "Guanacaste")
P("teotihuacan", ["Teotihuacan Pyramid of the Sun", "Mexico City Palacio de Bellas Artes"], "Teotihuacán", "Città del Messico")
P("maroon-bells", ["Maroon Bells"], "Maroon Bells, Aspen", "Aspen")
P("rmnp", ["Rocky Mountain National Park", "Trail Ridge Road"], "Rocky Mountain NP", "Estes Park", "Rocky Mountain")
P("sand-dunes", ["Great Sand Dunes National Park"], "Great Sand Dunes", "Great Sand Dunes")
P("mesa-verde", ["Mesa Verde Cliff Palace"], "Mesa Verde", "Mesa Verde")
P("ouray", ["Million Dollar Highway", "Ouray Colorado"], "Million Dollar Highway", "Ouray")
P("telluride", ["Telluride Colorado"], "Telluride", "Telluride")
P("bryce", ["Bryce Canyon", "Arches National Park Delicate Arch"], "Bryce Canyon, Utah", "Salt Lake")
P("mono-lake", ["Mono Lake tufa"], "Mono Lake", "Mono Lake")
P("yosemite", ["Yosemite Valley Tunnel View", "Yosemite Valley"], "Yosemite Valley", "Yosemite")
P("mammoth", ["Minarets Sierra Nevada", "Mammoth Lakes"], "Mammoth Lakes", "Mammoth", "June Lake")
P("alabama-hills", ["Alabama Hills Mount Whitney", "Alabama Hills"], "Alabama Hills", "Lone Pine", "Bishop")
P("tahoe", ["Emerald Bay Lake Tahoe", "Lake Tahoe"], "Lake Tahoe", "Tahoe")
P("grand-teton", ["Grand Teton Snake River", "Grand Teton National Park"], "Grand Teton", "Grand Teton", "Jackson")
P("yellowstone", ["Grand Prismatic Spring", "Yellowstone"], "Yellowstone", "Yellowstone", "Canyon Village")
P("rainier", ["Mount Rainier Reflection Lake", "Mount Rainier"], "Mount Rainier", "Mount Rainier")
P("olympic", ["Olympic National Park Ruby Beach", "Hoh Rainforest"], "Olympic NP", "Olympic", "Kalaloch")
P("north-cascades", ["Diablo Lake", "North Cascades National Park"], "North Cascades", "North Cascades")
P("seattle", ["Seattle skyline Kerry Park", "Seattle skyline"], "Seattle", "Seattle")
P("cannon-beach", ["Cannon Beach Haystack Rock"], "Cannon Beach", "Cannon Beach")
P("san-juan", ["San Juan Islands Washington", "Orcas Island"], "Isole San Juan", "San Juan", "Orcas")
P("denali", ["Denali mountain", "Denali National Park"], "Denali", "Denali", "Talkeetna")
P("seward", ["Kenai Fjords National Park", "Seward Alaska"], "Kenai Fjords, Seward", "Seward")
P("homer", ["Homer Alaska Kachemak Bay", "Homer Spit"], "Homer", "Homer")
P("matanuska", ["Matanuska Glacier"], "Ghiacciaio Matanuska", "Matanuska")
P("kennicott", ["Kennecott Alaska", "Wrangell-St. Elias National Park"], "Wrangell-St. Elias", "McCarthy")
P("anchorage", ["Turnagain Arm", "Anchorage skyline Chugach"], "Turnagain Arm", "Anchorage", "Girdwood")
P("na-pali", ["Na Pali Coast", "Waimea Canyon"], "Na Pali, Kauai")
P("montreal", ["Montreal skyline Mount Royal", "Old Montreal"], "Montréal", "Montréal")
P("quebec-city", ["Château Frontenac Quebec", "Old Quebec"], "Québec City", "Québec City")
P("tadoussac", ["Tadoussac", "Humpback whale Saint Lawrence"], "Tadoussac", "Tadoussac")
P("saguenay", ["Saguenay Fjord", "Parc national du Fjord-du-Saguenay"], "Fiordo del Saguenay", "Saguenay")
P("perce", ["Percé Rock", "Rocher Percé"], "Rocher Percé, Gaspésie", "Percé", "Forillon")
P("charlevoix", ["Charlevoix Quebec landscape", "Baie-Saint-Paul"], "Charlevoix", "Charlevoix", "Baie-Saint-Paul")
P("mauricie", ["La Mauricie National Park", "Mont-Tremblant"], "La Mauricie", "Mauricie", "Mont-Tremblant")
P("moraine", ["Moraine Lake"], "Moraine Lake")
P("lake-louise", ["Lake Louise Alberta"], "Lake Louise", "Lake Louise")
P("banff", ["Banff town Cascade Mountain", "Vermilion Lakes Mount Rundle", "Banff National Park"], "Banff", "Banff", "Canmore")
P("icefields", ["Peyto Lake", "Icefields Parkway"], "Peyto Lake, Icefields Parkway", "Icefields", "Saskatchewan Crossing")
P("jasper", ["Maligne Lake Spirit Island", "Jasper National Park"], "Maligne Lake, Jasper", "Jasper")
P("yoho", ["Emerald Lake Yoho", "Takakkaw Falls"], "Yoho", "Yoho")
P("waterton", ["Waterton Lakes National Park"], "Waterton Lakes", "Waterton")
P("tofino", ["Tofino beach", "Pacific Rim National Park Long Beach"], "Tofino", "Tofino", "Whistler")
P("peggys-cove", ["Peggys Cove lighthouse", "Cabot Trail"], "Peggy's Cove", "Halifax", "Cape Breton")

# ---------------------------------------------------------------- Aggiunte del 24 novembre 2026
P("mana-pools", ["Mana Pools National Park", "Mana Pools Zambezi"], "Mana Pools", "Mana Pools")
P("hwange", ["Hwange elephants", "Hwange National Park"], "Hwange", "Hwange")
P("kariba", ["Lake Kariba Matusadona", "Lake Kariba"], "Lago Kariba", "Kariba")
P("kgalagadi", ["Kgalagadi Transfrontier Park", "Kgalagadi lion"], "Kgalagadi", "Kgalagadi")
P("augrabies", ["Augrabies Falls"], "Cascate di Augrabies", "Augrabies")
P("loango", ["Loango National Park", "Loango Gabon"], "Loango", "Loango")
P("lope", ["Lopé National Park", "Lope Gabon"], "Lopé", "Lopé")
P("ruaha", ["Ruaha National Park", "Great Ruaha River"], "Ruaha", "Ruaha")
P("nyerere", ["Selous Game Reserve Rufiji", "Selous Game Reserve", "Nyerere National Park"], "Rufiji, Nyerere", "Nyerere")
P("tundavala", ["Tundavala", "Serra da Leba"], "Tundavala, Lubango", "Lubango")
P("namibe", ["Namibe desert Angola", "Iona National Park Angola", "Namibe Angola"], "Deserto di Namibe", "Namibe")
P("kalandula", ["Kalandula Falls"], "Cascate di Kalandula", "Kalandula")
P("kuelap", ["Kuelap", "Kuélap fortress"], "Kuélap", "Chachapoyas")
P("gocta", ["Catarata de Gocta", "Gocta waterfall", "Gocta Cataracts"], "Cascata di Gocta")
P("anavilhanas", ["Anavilhanas", "Rio Negro Amazon"], "Anavilhanas, Rio Negro", "Anavilhanas", "Rio Negro")
P("manaus", ["Encontro das Águas Manaus", "Meeting of Waters Manaus", "Teatro Amazonas"], "Manaus", "Manaus", "Presidente Figueiredo")
P("st-johns", ["St. John's Newfoundland harbour", "Signal Hill St. John's", "St. John's Newfoundland"], "St. John's", "St. John's")
P("gros-morne", ["Western Brook Pond", "Gros Morne National Park"], "Western Brook Pond, Gros Morne", "Gros Morne", "Deer Lake")
P("bonavista", ["Cape Bonavista", "Trinity Newfoundland", "Elliston Newfoundland"], "Penisola di Bonavista", "Bonavista")
P("fogo-island", ["Fogo Island Newfoundland", "Tilting Fogo Island"], "Fogo Island", "Fogo Island")
P("twillingate", ["Twillingate"], "Twillingate", "Twillingate")
P("churchill", ["Beluga whales Churchill", "Polar bear Churchill Manitoba", "Churchill Manitoba Hudson Bay"], "Churchill, baia di Hudson", "Churchill")
P("riding-mountain", ["Riding Mountain National Park"], "Riding Mountain", "Riding Mountain")
P("winnipeg", ["Winnipeg skyline", "The Forks Winnipeg"], "Winnipeg", "Winnipeg")
P("great-bear", ["Great Bear Rainforest", "Bella Coola", "Bella Coola valley"], "Great Bear Rainforest", "Bella Coola")
P("telegraph-cove", ["Telegraph Cove", "Johnstone Strait"], "Telegraph Cove", "Telegraph Cove", "Port Hardy")
P("kluane", ["Kluane National Park", "Kathleen Lake Kluane"], "Kluane", "Kluane", "Whitehorse")
P("dawson", ["Dawson City Yukon", "Dawson City"], "Dawson City", "Dawson City")
P("tombstone", ["Tombstone Territorial Park"], "Tombstone", "Tombstone")
P("glacier-np", ["Grinnell Glacier", "Many Glacier", "Glacier National Park Montana"], "Glacier National Park", "Many Glacier", "Lake McDonald", "St. Mary", "Whitefish")
P("samosir", ["Samosir Batak house", "Tuk Tuk Samosir", "Samosir"], "Samosir, lago Toba", "Samosir")
P("berastagi", ["Mount Sibayak", "Berastagi"], "Sibayak, Berastagi", "Berastagi")
P("tanjung-puting", ["Tanjung Puting National Park", "Camp Leakey", "Tanjung Puting orangutan"], "Tanjung Puting", "Tanjung Puting")
P("sumba", ["Ratenggaro", "Sumba traditional village", "Sumba Indonesia"], "Ratenggaro, Sumba", "Sumba")
P("waingapu", ["Walakiri beach", "Sumba savanna", "East Sumba"], "Sumba est", "Waingapu")
P("zanskar", ["Phugtal Monastery", "Zanskar valley", "Karsha Monastery"], "Zanskar", "Padum", "Phugtal", "Lingshed", "Rangdum")
P("lamayuru", ["Lamayuru Monastery", "Lamayuru"], "Lamayuru", "Lamayuru", "Alchi")
P("spiti", ["Key Monastery", "Spiti valley"], "Monastero di Key, Spiti", "Kaza", "Tabo")
P("chandratal", ["Chandra Taal", "Chandratal lake"], "Lago Chandratal", "Chandratal", "Jispa")
P("bako", ["Bako National Park"], "Bako, Sarawak", "Bako")
P("mulu", ["Gunung Mulu Pinnacles", "Gunung Mulu National Park", "Deer Cave Mulu"], "Mulu", "Mulu", "Camp 5")
P("kuching", ["Kuching waterfront", "Kuching"], "Kuching", "Kuching", "Batang Ai", "Miri")
P("tasiilaq", ["Tasiilaq"], "Tasiilaq, Groenlandia orientale", "Tasiilaq")
P("vik", ["Reynisfjara", "Vík í Mýrdal"], "Reynisfjara, Vík", "Costa sud")
P("skye", ["Quiraing", "Old Man of Storr"], "Isola di Skye", "Skye")
P("luskentyre", ["Luskentyre", "Isle of Harris beach"], "Luskentyre, Harris", "Harris")
P("callanish", ["Callanish Stones", "Calanais"], "Pietre di Callanish, Lewis", "Lewis")
P("glencoe", ["Glen Coe", "Buachaille Etive Mor"], "Glencoe", "Glencoe")
P("edinburgh", ["Edinburgh skyline Calton Hill", "Edinburgh Castle"], "Edimburgo", "Edimburgo")
P("orkney", ["Ring of Brodgar", "Skara Brae"], "Orcadi", "Orcadi")
P("ullapool", ["Ullapool", "Stac Pollaidh"], "Ullapool", "Ullapool", "Durness")
P("uluru", ["Uluru", "Kata Tjuta"], "Uluru", "Uluru", "Kings Canyon", "Alice Springs")
P("gibb-river", ["Bell Gorge", "Windjana Gorge", "Gibb River Road"], "Kimberley, Gibb River Road", "Bell Gorge", "Windjana", "Manning Gorge", "Broome", "Dampier")

COVER = {
 "DPS": "bali", "LOP": "rinjani", "CMB": "sigiriya", "KUL": "kuala-lumpur", "BKI": "kinabalu", "UBN": "mongolia", "FRU": "song-kul",
 "ALA": "almaty", "TBS": "tbilisi", "EVN": "khor-virap", "CNS": "barrier-reef", "DRW": "kakadu", "PER": "pinnacles", "AKL": "auckland",
 "ZQN": "queenstown", "PPT": "moorea", "NAN": "fiji", "NBO": "masai-mara", "MBA": "diani", "JRO": "kilimanjaro", "ZNZ": "zanzibar",
 "KGL": "volcanoes", "EBB": "bwindi", "WDH": "sossusvlei", "MUB": "okavango", "VFA": "victoria-falls", "TNR": "baobab", "NOS": "nosy-be",
 "MRU": "le-morne", "SEZ": "seychelles", "RUN": "mafate", "LIM": "lima", "CUZ": "cusco", "LPB": "la-paz", "SCL": "atacama",
 "EZE": "buenos-aires", "BRC": "bariloche", "UIO": "cotopaxi", "GPS": "galapagos", "GIG": "rio", "SSA": "salvador", "SLZ": "lencois",
 "FOR": "jericoacoara", "SJO": "arenal", "LIR": "guanacaste", "MEX": "teotihuacan", "DEN": "maroon-bells", "SLC": "bryce",
 "LAS": "mono-lake", "JAC": "grand-teton", "SEA": "rainier", "ANC": "denali", "HNL": "na-pali", "YUL": "montreal", "YQB": "quebec-city",
 "YYC": "moraine", "YHZ": "peggys-cove", "CPT": "cape-town", "JNB": "blyde", "DUR": "drakensberg", "PLZ": "addo", "CTS": "biei",
 "OKA": "okinawa", "KIX": "nachi", "HND": "kamikochi", "FUK": "aso", "AGA": "taghazout", "ASR": "cappadocia", "TZX": "sumela",
 "IXL": "ladakh", "DEL": "delhi", "USM": "samui", "BKK": "bangkok", "AMM": "petra", "DXB": "dubai", "MNL": "palawan", "SIN": "singapore",
 "URC": "kanas", "KHG": "karakul", "XNN": "qinghai-lake", "LHW": "zhangye", "HLD": "hulunbuir", "LXA": "potala", "TFU": "siguniang", "PEK": "grande-muraglia",
 "DYU": "pamir", "ISB": "hunza", "LBJ": "komodo", "UPG": "toraja", "SOQ": "raja-ampat", "GYD": "baku", "VNX": "bazaruto", "MPM": "tofo",
 "MFU": "south-luangwa", "LUN": "lower-zambezi", "LLW": "lake-malawi", "SID": "sal", "BVC": "boa-vista", "RAI": "fogo", "VXE": "santo-antao", "TMS": "sao-tome",
 "SLA": "humahuaca", "JUJ": "purmamarca", "CJC": "tatio", "CGB": "pantanal", "CGR": "bonito", "OAX": "oaxaca", "GUA": "atitlan", "KEF": "jokulsarlon",
 "PDL": "sete-cidades", "TER": "terceira", "FNC": "madeira", "FAE": "faroe", "EVE": "reine", "BOO": "henningsvaer", "TOS": "tromso", "LYR": "svalbard",
 "GOH": "nuuk", "JAV": "ilulissat",
}
GALLERY = {
 "DPS": ["nusa-penida", "uluwatu", "bromo", "munduk", "gili"],
 "CMB": ["kandy", "ella", "nuwara-eliya", "trincomalee"],
 "KUL": ["penang", "cameron", "perhentian", "kinabatangan", "sepilok", "tioman"],
 "TBS": ["gergeti", "ushguli", "sighnaghi", "mestia", "kutaisi"],
 "EVN": ["dilijan", "sevan", "tatev", "haghpat", "noravank"],
 "MBA": ["amboseli", "tsavo", "lamu", "masai-mara"],
 "ZNZ": ["stone-town", "serengeti", "ngorongoro", "nungwi", "tarangire"],
 "WDH": ["deadvlei", "etosha", "swakopmund", "damaraland", "fish-river", "epupa"],
 "MRU": ["chamarel", "blue-bay", "grand-baie", "rodrigues", "fournaise"],
 "LIM": ["machu-picchu", "cusco", "sacred-valley", "huacachina", "huaraz", "colca"],
 "SCL": ["valparaiso", "uyuni", "lagunas", "santiago"],
 "EZE": ["iguazu", "humahuaca", "cafayate", "salta", "peninsula-valdes"],
 "GIG": ["ilha-grande", "paraty", "ouro-preto", "pantanal"],
 "DEN": ["rmnp", "sand-dunes", "mesa-verde", "ouray", "telluride"],
 "LAS": ["yosemite", "mammoth", "alabama-hills", "tahoe"],
 "SEA": ["olympic", "north-cascades", "seattle", "cannon-beach", "san-juan"],
 "ANC": ["seward", "homer", "matanuska", "kennicott", "anchorage"],
 "YUL": ["quebec-city", "tadoussac", "saguenay", "perce", "mauricie"],
 "YYC": ["banff", "icefields", "jasper", "yoho", "lake-louise", "waterton"],
 "CPT": ["cederberg", "namaqualand", "hermanus", "franschhoek", "de-hoop"],
 "JNB": ["kruger", "sabi-sand", "eswatini", "johannesburg"],
 "KIX": ["koyasan", "kumano", "nara", "iya", "osaka", "shimanami"],
 "HND": ["shirakawa", "takayama", "matsumoto", "kanazawa", "tateyama", "tokyo"],
 "AGA": ["essaouira", "imsouane", "tafraoute", "legzira"],
 "ASR": ["nemrut", "mardin", "ihlara", "ishak-pasha", "akdamar"],
 "SIN": ["bromo", "ijen", "toba", "borobudur", "bukit-lawang", "tioman"],
 "URC": ["sayram", "nalati", "tianchi", "turpan", "dunhuang"],
 "KHG": ["kashgar", "sayram", "nalati"],
 "XNN": ["chaka", "dunhuang", "zhangye", "labrang", "jiayuguan"],
 "LHW": ["dunhuang", "jiayuguan", "labrang", "lanzhou", "qinghai-lake"],
 "LXA": ["yamdrok", "everest-nord"],
 "TFU": ["danba", "tagong", "yading", "jiuzhaigou", "chengdu"],
 "PEK": ["pechino"],
 "DYU": ["iskanderkul"], "ISB": ["fairy-meadows", "skardu"], "LBJ": ["kelimutu", "wae-rebo"], "UPG": ["bunaken", "togean"],
 "GYD": ["sheki", "khinalug", "sighnaghi", "tbilisi"], "VNX": ["tofo", "kruger"], "MPM": ["maputo", "bazaruto"], "MFU": ["lower-zambezi", "lake-malawi"],
 "LUN": ["south-luangwa", "victoria-falls"], "LLW": ["liwonde"], "SID": ["santo-antao", "mindelo"], "BVC": ["sal"], "RAI": ["cidade-velha", "santo-antao", "mindelo"],
 "VXE": ["mindelo"], "TMS": ["principe"], "SLA": ["cafayate", "salta", "tolar-grande", "purmamarca"], "JUJ": ["humahuaca", "salta"],
 "CJC": ["atacama", "lagunas", "uyuni", "valparaiso"], "CGB": ["chapada-guimaraes"], "CGR": ["pantanal"], "OAX": ["hierve", "puebla", "teotihuacan"],
 "GUA": ["antigua", "tikal"], "KEF": ["skogafoss", "landmannalaugar", "myvatn", "kirkjufell"], "PDL": ["pico", "faial", "terceira", "azores-flores"],
 "TER": ["pico", "faial", "sete-cidades"], "FNC": ["levada", "funchal", "porto-santo"], "FAE": ["kalsoy", "gjogv"], "EVE": ["henningsvaer", "senja"],
 "BOO": ["reine", "senja", "tromso"], "TOS": ["senja", "svalbard", "reine"], "LYR": ["reine", "henningsvaer"], "GOH": ["ilulissat", "disko"], "JAV": ["disko"],
}
POPCOVER = {
 "georgia-armenia": "gergeti", "georgia-svaneti": "ushguli", "kirghizistan-almaty": "charyn", "mongolia-gobi": "khongor",
 "sri-lanka": "ella", "bali-lombok": "gili", "bali-flores-komodo": "komodo", "malesia-borneo": "perhentian", "hokkaido": "shiretoko",
 "tanzania-safari-zanzibar": "serengeti", "kenya-zanzibar": "amboseli", "uganda-rwanda": "bunyonyi", "namibia-classica": "deadvlei",
 "namibia-vicfalls": "etosha", "botswana-vicfalls": "chobe", "sudafrica-kruger-garden": "tsitsikamma", "madagascar-rn7": "isalo",
 "reunion-mauritius": "fournaise", "peru-classico": "machu-picchu", "peru-bolivia": "titicaca", "atacama-uyuni": "uyuni",
 "ecuador-galapagos": "quilotoa", "argentina-nord": "humahuaca", "argentina-bariloche": "llao-llao", "brasile-rota-emocoes": "jericoacoara",
 "canada-rockies": "icefields", "giava-bali": "bromo", "costa-rica": "arenal", "brasile-rio-iguacu": "iguazu", "canada-quebec": "saguenay", "usa-rockies-yellowstone": "yellowstone", "usa-pacific-northwest": "olympic",
 "cina-via-della-seta": "dunhuang", "cina-qinghai-gansu": "qinghai-lake", "cina-sichuan-ovest": "danba",
 "pamir-highway": "pamir", "flores-komodo-kelimutu": "kelimutu", "sulawesi-toraja-bunaken": "toraja", "baku-tbilisi": "sheki",
 "atacama-uyuni-salta": "lagunas", "pantanal-bonito": "pantanal", "messico-oaxaca": "hierve", "islanda-ring-road": "skogafoss", "azzorre-isole": "pico",
 "lofoten-tromso": "reine", "groenlandia-nuuk-ilulissat": "ilulissat", "kruger-mozambico": "bazaruto", "zambia-malawi": "south-luangwa",
 "capo-verde-isole": "santo-antao", "sao-tome-principe": "principe",
}
COVER.update({"HRE": "mana-pools", "LBV": "loango", "KNO": "toba", "CGK": "tanjung-puting", "DAR": "ruaha", "KCH": "bako", "MAO": "anavilhanas",
              "YYT": "st-johns", "YWG": "churchill", "YXY": "kluane", "LAD": "tundavala", "EDI": "skye"})
GALLERY.update({"HRE": ["hwange", "kariba", "victoria-falls"], "LBV": ["lope"], "KNO": ["bukit-lawang", "samosir", "berastagi"], "CGK": ["borobudur", "bromo"],
                "DAR": ["nyerere", "zanzibar"], "KCH": ["mulu", "kuching"], "MAO": ["manaus"], "YYT": ["gros-morne", "bonavista", "fogo-island", "twillingate"],
                "YWG": ["riding-mountain", "winnipeg"], "YXY": ["dawson", "tombstone"], "LAD": ["namibe", "kalandula"],
                "EDI": ["luskentyre", "callanish", "glencoe", "orkney", "edinburgh"], "IXL": ["zanskar", "spiti", "lamayuru", "chandratal"]})
POPCOVER.update({"zimbabwe-hwange-mana": "hwange", "sudafrica-namaqualand-kgalagadi": "kgalagadi", "gabon-loango": "loango", "tanzania-sud": "ruaha",
                 "angola-sud": "namibe", "peru-nord": "kuelap", "amazzonia-rio-negro": "anavilhanas", "canada-terranova": "gros-morne",
                 "canada-great-bear": "great-bear", "canada-churchill": "churchill", "canada-yukon": "tombstone", "glacier-waterton": "glacier-np",
                 "sumatra-nord": "bukit-lawang", "bali-sumba-komodo": "sumba", "borneo-tanjung-puting-giava": "tanjung-puting", "ladakh-zanskar": "zanskar",
                 "sarawak-mulu": "mulu", "islanda-groenlandia-est": "tasiilaq", "scozia-ebridi": "luskentyre"})
# correzioni dopo la revisione visiva: SKIP[k] = quanti candidati validi saltare; FILE[k] = titolo esatto su Commons
SKIP = {}
FILE = {"maputo": "File:60 Skyline (36931644911).jpg"}
try:
    from photos_fix import SKIP as _S, FILE as _F   # opzionale, vedi photos_fix.py
    SKIP.update(_S); FILE.update(_F)
except ImportError:
    pass

HERO = ["zanzibar", "sossusvlei", "bali", "le-morne", "masai-mara", "machu-picchu", "nusa-penida", "galapagos", "moorea", "seychelles"]   # copertine della home (v2.js)
LARGE = set(COVER.values()) | set(POPCOVER.values()) | set(HERO)

def norm(s):
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")

_last = {}
class Throttled(Exception):
    pass
def _get(url, timeout, gap):
    """GET educato: una richiesta alla volta, pausa minima per host, attesa sui 429. upload.wikimedia.org blocca l'IP per
    diversi minuti se si insiste: dopo 3 rifiuti di fila ci si ferma (Throttled) e si riprende piu' tardi da dove si era."""
    import urllib.error
    host = urllib.parse.urlsplit(url).netloc
    for attempt in range(3):
        wait = gap - (time.time() - _last.get(host, 0))
        if wait > 0: time.sleep(wait)
        _last[host] = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            if e.code != 429 and attempt: return None
            ra = e.headers.get("Retry-After") if e.headers else None
            time.sleep(min(120, (int(ra) if ra and ra.isdigit() else 45 * (attempt + 1)) + 1))
            if e.code == 429 and attempt == 2: raise Throttled(host)
        except Exception:
            time.sleep(3 + 5 * attempt)
    return None

def api(params):
    params = dict(params, format="json", formatversion="2")
    d = _get(API + "?" + urllib.parse.urlencode(params), 30, 3.0)
    try:
        return json.loads(d.decode("utf-8")) if d else {}
    except Exception:
        return {}

def fetch(url):
    return _get(url, 60, GAP if "wikimedia" in url else 1.0)

GAP = 10.0   # secondi tra due immagini scaricate

GENERIC = set("""beach lake mount mountain mountains national park island islands temple river valley sunrise sunset skyline monastery church
old town city bridge plantation rice terrace terraces street rock falls waterfall view aerial canyon desert dunes dune landscape castle palace
road north south east west coast bay hills hill forest reserve game crater volcano summit hot balloons marine with from the and lakes saint san santa
steppe yurt canal lavender blue pond five tomb statues trail scenic point lighthouse harbour harbor waterfront wine vineyards colonial panorama
grand great big little upper lower black white red green pass glacier peak route centre center historic village market garden gardens""".split())
def relevant(title, queries):
    """Il titolo del file deve contenere almeno una parola distintiva (non generica) di una delle query della chiave."""
    t = norm(title)
    toks = {w for q in queries for w in re.findall(r"[a-z]{4,}", norm(q)) if w not in GENERIC}
    return not toks or any(w in t for w in toks)

def strip(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()

def usable(p, large):
    ii = (p.get("imageinfo") or [{}])[0]
    if ii.get("mime") != "image/jpeg" or BAD.search(p["title"]):
        return None
    w, h = ii.get("width", 0), ii.get("height", 0)
    # sotto 1920 / 1280 px l'API restituisce l'originale su upload.wikimedia.org, che risponde 429: si chiedono solo miniature standard
    if w < (1920 if large else 1280) or not h:
        return None
    if not (1.15 <= w / h <= 2.05):
        return None
    em = ii.get("extmetadata") or {}
    cats = (em.get("Categories") or {}).get("value", "")
    if BADCAT.search(cats):
        return None
    yr = re.search(r"(1[5-9]\d\d|20\d\d)", strip((em.get("DateTimeOriginal") or {}).get("value", "")))
    if yr and int(yr.group(1)) < 1990:
        return None
    lic = (em.get("LicenseShortName") or {}).get("value", "")
    if not LIC_OK.match(lic.strip()) or re.search(r"nc|nd\b", lic, re.I):
        return None
    return {"title": p["title"], "thumb": ii.get("thumburl"), "page": ii.get("descriptionurl"), "license": lic.strip(),
            "license_url": (em.get("LicenseUrl") or {}).get("value", ""), "author": strip((em.get("Artist") or {}).get("value", ""))[:120] or "sconosciuto"}

def info(params, large):
    params = dict(params, prop="imageinfo", iiprop="url|size|mime|extmetadata", iiurlwidth=1920 if large else 1280,
                  iiextmetadatafilter="LicenseShortName|Artist|LicenseUrl|Categories|DateTimeOriginal")
    d = api(params)
    pages = (d.get("query") or {}).get("pages") or []
    pages.sort(key=lambda p: p.get("index", 0))
    return [u for u in (usable(p, large) for p in pages) if u]

def candidates(key):
    queries, cap, alias = PHOTOS[key]
    large = key in LARGE
    if key in FILE:
        c = info({"action": "query", "titles": FILE[key]}, large)
        if c: return c
        print("   FILE non utilizzabile:", FILE[key])
    out, seen = [], set()
    for q in queries:
        for c in info({"action": "query", "generator": "search", "gsrnamespace": 6, "gsrlimit": 25,
                       "gsrsearch": q + " filetype:bitmap"}, large):
            if c["title"] not in seen and relevant(c["title"], queries):
                seen.add(c["title"]); out.append(c)
        if len(out) > SKIP.get(key, 0):
            return out
    return out

OV_LIC = {"by": "CC BY", "by-sa": "CC BY-SA", "cc0": "CC0", "pdm": "Public domain"}
def candidates_ov(key):
    """Seconda fonte: Openverse (API anonima: 20 richieste al minuto, 200 al giorno), solo foto Flickr con licenza libera.
    Flickr da' al massimo 1024 px: va bene per gallery e tappe, non per le copertine (quelle restano su Commons)."""
    queries, cap, alias = PHOTOS[key]
    out = []
    for q in queries[:2]:
        d = _get("https://api.openverse.org/v1/images/?" + urllib.parse.urlencode({"q": q, "license": "by,by-sa,cc0,pdm", "source": "flickr",
                 "aspect_ratio": "wide", "category": "photograph", "page_size": 20}), 30, 3.3)
        try:
            res = json.loads(d.decode("utf-8")).get("results", []) if d else []
        except Exception:
            res = []
        for x in res:
            w, h = x.get("width") or 0, x.get("height") or 0
            tags = " ".join(t.get("name", "") for t in (x.get("tags") or []))
            if w < 1000 or not h or not (1.15 <= w / h <= 2.05) or x.get("license") not in OV_LIC: continue
            if BAD.search(x.get("title") or "") or not relevant((x.get("title") or "") + " " + tags, queries): continue
            lic = OV_LIC[x["license"]] + ((" " + x["license_version"]) if x.get("license_version") and x["license"] in ("by", "by-sa") else "")
            out.append({"title": x.get("title") or "", "thumb": x["url"], "page": x.get("foreign_landing_url") or x["url"], "license": lic,
                        "license_url": x.get("license_url") or "", "author": (x.get("creator") or "sconosciuto")[:120]})
        if len(out) > SKIP.get(key, 0):
            break
    return out

def save(data, path, large):
    from PIL import Image, ImageOps
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    W = 1600 if large else 1000
    if im.width > W:
        im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
    cap_kb = 270 if large else 140
    for q in (80, 74, 68, 62, 56, 50, 44):
        buf = io.BytesIO(); im.save(buf, "WEBP", quality=q, method=4)
        if buf.tell() <= cap_kb * 1024: break
    open(path, "wb").write(buf.getvalue())
    return im.width, im.height, buf.tell()

def load():
    p = os.path.join(IMG, "credits.json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}

def write(cred):
    json.dump(cred, open(os.path.join(IMG, "credits.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    by = {v["key"]: f for f, v in cred.items()}
    man = {"photos": {k: {"f": "img/" + by[k], "w": cred[by[k]]["w"], "h": cred[by[k]]["h"], "cap": PHOTOS[k][1],
                          "by": cred[by[k]]["author"], "lic": cred[by[k]]["license"], "src": cred[by[k]]["source"]} for k in PHOTOS if k in by},
           "cover": {c: k for c, k in COVER.items() if k in by},
           "gallery": {c: [k for k in ks if k in by] for c, ks in GALLERY.items()},
           "pop": {c: k for c, k in POPCOVER.items() if k in by},
           "stage": sorted(([norm(a), k] for k in PHOTOS if k in by for a in PHOTOS[k][2]), key=lambda x: -len(x[0]))}
    json.dump(man, open(os.path.join(IMG, "manifest.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

def main():
    os.makedirs(IMG, exist_ok=True)
    cred = load()
    args = sys.argv[1:]
    if "--stats" in args:
        files = [f for f in os.listdir(IMG) if f.endswith(".webp")]
        tot = sum(os.path.getsize(os.path.join(IMG, f)) for f in files)
        have = {v["key"] for v in cred.values()}
        print("webp:", len(files), "| MB: %.1f" % (tot / 1e6), "| chiavi:", len(PHOTOS), "| mancanti:", sorted(set(PHOTOS) - have))
        write(cred); return
    if "--sheet" in args:
        return sheet(cred)
    redo = set(args[args.index("--redo") + 1:]) if "--redo" in args else set()
    # una chiave gia' scaricata piccola ma ora usata come copertina va rifatta grande
    have = {v["key"] for v in cred.values() if not (v["key"] in LARGE and v["w"] < 1500)}
    order = list(dict.fromkeys(list(COVER.values()) + list(POPCOVER.values()) + [k for ks in GALLERY.values() for k in ks] + list(PHOTOS)))
    if "--recheck" in args:   # rifa' anche le foto gia' scaricate il cui titolo non contiene il luogo cercato
        redo |= {v["key"] for v in cred.values() if v["key"] in PHOTOS and v["key"] not in FILE and (BAD.search(v["title"]) or not relevant(v["title"], PHOTOS[v["key"]][0]))}
        for v in list(cred.values()):   # e quelle che oggi non passerebbero i filtri (dipinti, foto storiche, categorie escluse)
            if v["key"] in PHOTOS and v["key"] not in redo and not v.get("chk"):
                if info({"action": "query", "titles": v["title"]}, False): v["chk"] = 1
                else: redo.add(v["key"])
        write(cred)
        print("da rifare per pertinenza:", sorted(redo)); sys.stdout.flush()
    todo = [k for k in order if k in PHOTOS and (k not in have or k in redo)]
    OV = "--ov" in args          # --ov: Openverse/Flickr, solo chiavi non di copertina
    if OV: todo = [k for k in todo if k not in LARGE]
    if "--large" in args: todo = [k for k in todo if k in LARGE]
    def work(key):
        cs = candidates_ov(key) if OV else candidates(key)
        n = SKIP.get(key, 0)
        for c in cs[n:n + 4]:
            data = fetch(c["thumb"]) if c["thumb"] else None
            if not data: continue
            fn = key + ".webp"
            try:
                w, h, size = save(data, os.path.join(IMG, fn), key in LARGE)
            except Exception as e:
                print("   errore immagine", key, e); continue
            cred[fn] = {"key": key, "caption": PHOTOS[key][1], "title": c["title"], "author": c["author"], "license": c["license"],
                        "license_url": c["license_url"], "source": c["page"], "w": w, "h": h, "bytes": size, "chk": 1}
            write(cred)
            print("ok  %-18s %4dx%-4d %4d KB  %s" % (key, w, h, size // 1024, c["title"][:70])); sys.stdout.flush()
            return
        print("--  %-18s NESSUNA FOTO (candidati: %d)" % (key, len(cs))); sys.stdout.flush()
    for key in todo:
        try:
            work(key)
        except Throttled as e:
            print("STOP: %s rifiuta le richieste (429). Riprovare tra qualche minuto: il download riprende da qui." % e); break
    write(cred)

def sheet(cred):
    from PIL import Image, ImageDraw
    out = os.path.join(ROOT, "screens"); os.makedirs(out, exist_ok=True)
    items = sorted(cred.items(), key=lambda kv: list(PHOTOS).index(kv[1]["key"]) if kv[1]["key"] in PHOTOS else 999)
    TW, TH, COLS, ROWS = 300, 218, 6, 7
    for n in range(0, len(items), COLS * ROWS):
        im = Image.new("RGB", (TW * COLS, TH * ROWS), "white"); dr = ImageDraw.Draw(im)
        for i, (fn, v) in enumerate(items[n:n + COLS * ROWS]):
            t = Image.open(os.path.join(IMG, fn)).convert("RGB"); t.thumbnail((TW - 6, TH - 22))
            x, y = (i % COLS) * TW + 3, (i // COLS) * TH + 2
            im.paste(t, (x, y)); dr.text((x, y + TH - 20), v["key"], fill="black")
        im.save(os.path.join(out, "sheet-%d.jpg" % (n // (COLS * ROWS) + 1)), quality=72)
    print("fogli:", (len(items) - 1) // (COLS * ROWS) + 1)

if __name__ == "__main__":
    main()
