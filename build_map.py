# -*- coding: utf-8 -*-
"""Contorno delle terre emerse per la pagina Mappa -> world.json (file statico, gia' nel repo: si rigenera solo a mano).

  python build_map.py [land-110m.json]

Sorgente: Natural Earth 1:110m via world-atlas 2.0.2 (TopoJSON, pubblico dominio), scaricato da jsDelivr se non si passa
un file locale. Proiezione equirettangolare, la stessa di v2.js (mapXY): x = (lon + 180) * k, y = (lat0 - lat) * k.
"""
import json, sys, urllib.request

URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json"
W, LAT0, LAT1 = 1000.0, 82.0, -58.0
K = W / 360.0


def load(path=None):
    if path:
        return json.load(open(path, encoding="utf-8"))
    req = urllib.request.Request(URL, headers={"User-Agent": "static-map-builder/1.0"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode("utf-8"))


def arcs(topo):
    sx, sy = topo["transform"]["scale"]; tx, ty = topo["transform"]["translate"]
    out = []
    for a in topo["arcs"]:
        x = y = 0; pts = []
        for dx, dy in a:
            x += dx; y += dy
            pts.append((x * sx + tx, y * sy + ty))
        out.append(pts)
    return out


def ring(idx, A):
    pts = []
    for i in idx:
        seg = A[i] if i >= 0 else A[~i][::-1]
        pts.extend(seg[1:] if pts else seg)
    return pts


def main():
    topo = load(sys.argv[1] if len(sys.argv) > 1 else None)
    A = arcs(topo)
    polys = []
    for g in topo["objects"]["land"]["geometries"]:
        polys.extend(g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]])
    d = []
    for poly in polys:
        for r in poly:
            pts = ring(r, A)
            if max(p[1] for p in pts) < LAT1:        # Antartide: fuori dal riquadro
                continue
            # anello a cavallo dell'antimeridiano (Russia orientale, Figi): tra due punti consecutivi la longitudine salta
            # da +180 a -180. Lo si spezza in tratti che iniziano e finiscono sullo stesso bordo della mappa: ogni
            # tratto si chiude lungo il bordo, senza righe che attraversano tutto il planisfero.
            if pts[0] == pts[-1]:
                pts = pts[:-1]
            n = len(pts)
            jumps = [i for i in range(n) if abs(pts[i][0] - pts[i - 1][0]) > 180]
            pieces = [pts]
            if jumps:
                pts = pts[jumps[0]:] + pts[:jumps[0]]
                cuts = [j - jumps[0] for j in jumps] + [n]
                pieces = [pts[cuts[i]:cuts[i + 1]] for i in range(len(jumps))]
            for piece in pieces:
                xy, last = [], None
                for lon, lat in piece:
                    q = (round((lon + 180) * K, 1), round((LAT0 - max(LAT1, min(LAT0, lat))) * K, 1))
                    if q != last:
                        xy.append(q); last = q
                if len(xy) >= 3:
                    d.append("M" + "L".join("%g %g" % q for q in xy) + "Z")
    out = {"w": int(W), "h": round((LAT0 - LAT1) * K, 1), "lat0": LAT0, "k": round(K, 5), "src": "Natural Earth 1:110m (world-atlas 2.0.2)", "d": "".join(d)}
    s = json.dumps(out, separators=(",", ":"))
    open("world.json", "w", encoding="utf-8", newline="\n").write(s)
    print("world.json", len(s), "caratteri,", len(d), "poligoni")


if __name__ == "__main__":
    main()
