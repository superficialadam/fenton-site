
#!/usr/bin/env python3
import argparse, os, struct, hashlib
from PIL import Image, ImageDraw

MAGIC = 0x43454C31  # 'CEL1'
HEADER_FMT = "<I I H H H H"  # magic,count,wCells,hCells,block,flags
ENTRY_FMT  = "<ffBBBB"       # uvx,uvy,r,g,b,a

def luma(r,g,b): return 0.2126*r + 0.7152*g + 0.0722*b

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("outbin")
    ap.add_argument("--block", type=int, default=1)
    ap.add_argument("--black", type=int, default=10)
    ap.add_argument("--alpha", type=int, default=8)
    ap.add_argument("--preview", default=None)
    a = ap.parse_args()

    img = Image.open(a.image).convert("RGBA")
    w,h = img.size
    wC,hC = w//a.block, h//a.block
    img = img.crop((0,0,wC*a.block, hC*a.block))
    px = img.load()

    preview = Image.new("RGBA", img.size, (0,0,0,0)) if a.preview else None
    draw = ImageDraw.Draw(preview) if preview else None

    entries=[]
    bs=a.block
    for jy in range(hC):
        for ix in range(wC):
            r=g=b=alp=0
            for y in range(jy*bs, jy*bs+bs):
                for x in range(ix*bs, ix*bs+bs):
                    R,G,B,A = px[x,y]
                    r+=R; g+=G; b+=B; alp+=A
            n=bs*bs
            R=r//n; G=g//n; B=b//n; A=alp//n
            if A < a.alpha or luma(R,G,B) < a.black: continue
            u=(ix+0.5)/wC; v=(jy+0.5)/hC
            entries.append((u,v,R,G,B,A))
            if draw: draw.rectangle([ix*bs, jy*bs, ix*bs+bs-1, jy*bs+bs-1], fill=(R,G,B,255))

    os.makedirs(os.path.dirname(a.outbin) or ".", exist_ok=True)
    with open(a.outbin,"wb") as f:
        f.write(struct.pack(HEADER_FMT, MAGIC, len(entries), wC, hC, bs, 0))
        for (u,v,R,G,B,A) in entries:
            f.write(struct.pack(ENTRY_FMT, float(u), float(v), R,G,B,A))

    if preview: preview.save(a.preview)
    sha=hashlib.sha256(open(a.outbin,"rb").read()).hexdigest()[:16]
    print(f"cells.bin → {a.outbin}  count={len(entries)} grid={wC}x{hC} block={bs} sha={sha}")
    if a.preview: print(f"preview → {a.preview}")

if __name__ == "__main__":
    main()
