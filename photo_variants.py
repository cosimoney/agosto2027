# -*- coding: utf-8 -*-
"""Varianti ridotte delle foto gia' presenti in img/ (nessun download): img/<nome>-<larghezza>.webp

  python photo_variants.py            crea le varianti che mancano o piu' vecchie dell'originale
  python photo_variants.py --check    elenca solo cosa manca (exit 1 se manca qualcosa)

Larghezze: 480 e 800 per tutte, 1200 per le foto grandi (copertine da 1600). build_v2.py mette nel blob le varianti che
trova davvero su disco (campo "s" di ogni foto) e v2.js le usa in srcset: una foto senza varianti resta com'era.
Da rilanciare dopo photos.py quando arrivano foto nuove.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(ROOT, "img")
WIDTHS = (480, 800, 1200)
MIN_GAIN = 1.25          # niente variante se l'originale e' largo meno di 1,25 volte
QUALITY = 72


def variant(f, w):
    """img/bali.webp, 480 -> img/bali-480.webp"""
    stem, ext = os.path.splitext(f)
    return "%s-%d%s" % (stem, w, ext)


def wanted(photo):
    return [w for w in WIDTHS if photo["w"] >= w * MIN_GAIN]


def main():
    check = "--check" in sys.argv
    man = json.load(open(os.path.join(IMG, "manifest.json"), encoding="utf-8"))
    todo = []
    for k, p in sorted(man["photos"].items()):
        src = os.path.join(ROOT, p["f"])
        if not os.path.exists(src):
            continue
        for w in wanted(p):
            dst = os.path.join(ROOT, variant(p["f"], w))
            if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
                todo.append((src, dst, w))
    if check:
        for _, dst, _ in todo:
            print("manca", os.path.relpath(dst, ROOT))
        print(len(todo), "varianti da creare")
        sys.exit(1 if todo else 0)
    from PIL import Image
    tot = 0
    for src, dst, w in todo:
        with Image.open(src) as im:
            im = im.convert("RGB")
            h = round(im.height * w / im.width)
            im.resize((w, h), Image.LANCZOS).save(dst, "WEBP", quality=QUALITY, method=6)
        tot += os.path.getsize(dst)
    print("varianti create:", len(todo), "| %.1f MB" % (tot / 1e6))


if __name__ == "__main__":
    main()
