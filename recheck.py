import json, random, time, sys, scan, gf
random.seed(int(sys.argv[2]) if len(sys.argv)>2 else 1)
rows=[json.loads(l) for l in open("raw.jsonl",encoding="utf-8")]
okd={r["k"].split("|")[1] for r in rows if r["st"]=="ok"}
emp=[r["k"] for r in rows if r["st"]=="empty" and (r["k"].split("|")[1] in okd)==(sys.argv[1]=="partial")]
flip=0; s=random.sample(emp,int(sys.argv[3]) if len(sys.argv)>3 else 30)
for k in s:
    o,d,dep,ret,ms=k.split("|")
    st,fl=gf.fetch(scan.q(o,d,dep,ret,int(ms)),tries=1)
    if st=="ok": flip+=1; print("FLIP",k,len(fl),min(f["price"] for f in fl),flush=True)
    time.sleep(1.2)
print("flipped",flip,"of",len(s),"| empties in group",len(emp))
