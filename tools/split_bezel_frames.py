"""One-time split (Oct 2026): Diver/GMT bezel files carried the toothed steel frame AND the insert.
Now: parts/frames/frame-diver.webp (+ @g gold) is shared, and each bezel file is the insert ring only.
The frame is opaque right through the insert's soft edge zone (rim colours extended inward/outward), so an
insert drawn on top blends into it with no see-through seam."""
import json, os, numpy as np
from PIL import Image
B = os.path.join(os.path.dirname(__file__), "..", "images", "builds")
P = os.path.join(B, "parts")
R_IN, R_OUT, SOFT = 271.5, 338.5, 1.6            # insert band of every Diver/GMT bezel (canvas px)
N = 1500; yy, xx = np.mgrid[0:N, 0:N].astype(np.float32); rho = np.hypot(xx - 750, yy - 750)
th = np.arctan2(yy - 750, xx - 750)
band = np.clip((rho - R_IN) / SOFT + 0.5, 0, 1) * np.clip((R_OUT - rho) / SOFT + 0.5, 0, 1)
def load(f): return np.array(Image.open(f).convert("RGBA")).astype(np.float32)
def save(a, f): Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA").save(f, "WEBP", quality=95, alpha_quality=100, method=6)

def make_frame(src):
    a = load(src); out = a.copy()
    # rim colour just outside the band, carried radially into the band edge zones
    import cv2
    for r_from, lo, hi in ((R_IN - 1.5, R_IN - 0.9, R_IN + 6.0), (R_OUT + 1.5, R_OUT - 6.0, R_OUT + 0.9)):
        mx = (750 + np.cos(th) * r_from).astype(np.float32); my = (750 + np.sin(th) * r_from).astype(np.float32)
        ring = cv2.remap(a, mx, my, cv2.INTER_LINEAR)                       # smooth sample along the rim (no stipple)
        z = (rho >= lo) & (rho <= hi)
        out[z, :3] = ring[z, :3]; out[z, 3] = 255
    inner = (rho > R_IN + 6.0) & (rho < R_OUT - 6.0)
    out[inner, 3] = 0                                                       # hole where the insert goes
    return out

if __name__ == "__main__":
    reg = json.load(open(os.path.join(B, "registry.json")))
    os.makedirs(os.path.join(P, "frames"), exist_ok=True)
    save(make_frame(os.path.join(P, "bezels", "bezel-black.webp")), os.path.join(P, "frames", "frame-diver.webp"))
    save(make_frame(os.path.join(P, "bezels", "bezel-black@g.webp")), os.path.join(P, "frames", "frame-diver@g.webp"))
    n = 0
    for p in reg["parts"]:
        if p["cat"] != "bezels" or p.get("type") not in ("diver", "gmt"): continue
        f = os.path.join(P, "bezels", p["id"] + ".webp"); a = load(f)
        a[..., 3] = a[..., 3] * band                                          # keep only the insert ring
        save(a, f); n += 1
        g = os.path.join(P, "bezels", p["id"] + "@g.webp")
        if os.path.exists(g): os.remove(g)                                    # gold copies no longer needed
        p["variants"] = [v for v in p.get("variants", []) if v != "g"]
        if not p["variants"]: del p["variants"]
        p["frame"] = "frame-diver"
    reg["parts"].append({"id": "frame-diver", "cat": "frames", "label": "Diver / GMT bezel frame", "families": ["diver", "gmt"], "variants": ["g"]})
    open(os.path.join(B, "registry.json"), "w").write(json.dumps(reg, separators=(",", ":"), ensure_ascii=False))
    fam = json.load(open(os.path.join(B, "families.json")))
    for k in ("diver", "gmt"): fam[k]["frame"] = "frame-diver"
    json.dump(fam, open(os.path.join(B, "families.json"), "w"), indent=1)
    print(f"frames written; {n} bezels trimmed to insert-only; gold copies removed")
