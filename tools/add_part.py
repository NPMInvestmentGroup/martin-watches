#!/usr/bin/env python3
"""
MARTIN builder - add a part in one command.

    python3 tools/add_part.py bezel  photo.png --family diver    --label "Red & White"
    python3 tools/add_part.py bezel  photo.png --family satdiver --label "Blue"
    python3 tools/add_part.py dial   photo.png --label "Salmon"            (28.5 mm dials: Diver, GMT, Saturation, Dress, Women's)

What it does: finds the part in the photo, fits it to the shared 1500px canvas, writes
images/builds/parts/<cat>/<id>.webp, adds it to registry.json, writes a preview PNG (on steel and gold
cases) to tools/previews/, and regenerates builds.json if node + sharp are available.
Nothing is committed or pushed.

Best source photos: one part per image, straight-on, plain white background, as large as possible.
Not handled here (still done by hand): cases, straps/bracelets, hands, chronograph (29.5 mm) dials.
"""
import argparse, json, os, re, subprocess, sys
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
B = os.path.join(ROOT, "images", "builds"); P = os.path.join(B, "parts")
N = 1500; C = 750.0
DIAL_R = 264.5 * 1.06                       # dial radius on the canvas (tucks under every case's opening)

# where a bezel insert sits on the canvas, per family: inner/outer radius, and a vertical offset of each
# edge (the Saturation case's engraved ring sits ~8px high, so its insert's inner edge follows it)
BEZEL_BANDS = {
    "diver":    dict(r_in=271.5, r_out=338.5, dy_in=0.0, dy_out=0.0, frame="frame-diver"),
    "gmt":      dict(r_in=271.5, r_out=338.5, dy_in=0.0, dy_out=0.0, frame="frame-diver"),
    "satdiver": dict(r_in=262.5, r_out=369.0, dy_in=-8.5, dy_out=0.0, frame=None),
}
DEFAULTS = {   # what the preview watch is built from
    "diver":    dict(dial="dial-black", case="case-stainless", gold="case-gold", strap="bracelet-oyster", hands="hands-mercedes-silver", scale=1.0),
    "gmt":      dict(dial="dial-black", case="case-stainless", gold="case-gold", strap="bracelet-oyster", hands="hands-mercedes-silver", scale=1.0),
    "satdiver": dict(dial="dial-black", case="case-s-stainless", gold="case-s-gold", strap="bracelet-oyster@s", hands="hands-mercedes-silver", scale=0.83),
}

yy, xx = np.mgrid[0:N, 0:N].astype(np.float32); RHO = np.hypot(xx - C, yy - C); TH = np.mod(np.arctan2(yy - C, xx - C), 2 * np.pi)

def die(msg): print("\nSTOPPED: " + msg); sys.exit(1)
def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("&", " ")).strip("-")
def save(rgba, path): Image.fromarray(np.clip(rgba * 255, 0, 255).astype(np.uint8), "RGBA").save(path, "WEBP", quality=95, alpha_quality=100, method=6)

def load_photo(path):
    im = Image.open(path)
    if im.mode in ("RGBA", "LA") or "transparency" in im.info:          # transparent PNG: put it on white
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255)); bg.alpha_composite(im.convert("RGBA")); im = bg
    rgb = np.array(im.convert("RGB")); bgc = np.median(np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3), rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)]), 0)
    if bgc.min() < 200: print(f"  warning: the background is not white (median {bgc.astype(int)}); fitting may be off")
    return rgb, (np.abs(rgb.astype(np.int16) - bgc).max(2))

def radii(mask, c, th, rmax):
    rs = np.arange(2, rmax, 0.5); out = np.full(len(th), np.nan)
    for i, a in enumerate(th):
        x = np.clip(np.round(c[0] + np.cos(a) * rs), 0, mask.shape[1] - 1).astype(int); y = np.clip(np.round(c[1] + np.sin(a) * rs), 0, mask.shape[0] - 1).astype(int)
        on = np.nonzero(mask[y, x])[0]
        if len(on): out[i] = rs[on.max()]
    return out

def smooth_ring(th, r):
    ok = ~np.isnan(r); med = np.median(r[ok]); keep = ok & (np.abs(r - med) < 0.08 * med)    # ignore rays that hit a shadow or a stray mark
    A = np.c_[np.ones_like(th), np.cos(th), np.sin(th), np.cos(2 * th), np.sin(2 * th)]
    return A @ np.linalg.lstsq(A[keep], r[keep], rcond=None)[0]

def remap(rgb, mx, my, scale):
    src = rgb.astype(np.float32)
    if scale < 0.9: src = cv2.GaussianBlur(src, (0, 0), 0.45 / scale)    # shrinking a big photo: soften first, no jaggies
    out = cv2.remap(src, mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    if scale > 1.4:                                                      # enlarging a small photo: a little sharpening
        bl = cv2.GaussianBlur(out, (0, 0), 1.4); out = out + 0.6 * (out - bl)
    return np.clip(out, 0, 255) / 255.0

# ---------------------------------------------------------------- bezel insert
def fit_bezel(rgb, d, fam):
    m = ndi.binary_opening(d > 60, iterations=2)
    lab, n = ndi.label(m)
    if n == 0: die("could not find the bezel in the photo")
    ring = lab == (1 + int(np.argmax(ndi.sum(m, lab, range(1, n + 1)))))
    disc = ndi.binary_fill_holes(ring); hole = disc & ~ring
    hl, hn = ndi.label(hole)
    if hn == 0: die("found a solid shape, not a ring - is this a bezel insert with a clear centre?")
    hole = hl == (1 + int(np.argmax(ndi.sum(hole, hl, range(1, hn + 1)))))
    c = (np.array(ndi.center_of_mass(hole))[::-1] + np.array(ndi.center_of_mass(disc))[::-1]) / 2
    th = np.deg2rad(np.arange(0, 360, 1.0)); rmax = int(max(rgb.shape) * 0.75)
    ri = smooth_ring(th, radii(hole, c, th, rmax)); ro = smooth_ring(th, radii(disc, c, th, rmax))
    ratio = ro.mean() / ri.mean()
    print(f"  ring found: centre ({c[0]:.0f}, {c[1]:.0f}), inner r {ri.mean():.0f}, outer r {ro.mean():.0f} (outer/inner {ratio:.2f}), roundness {ro.min()/ro.max():.3f}")
    if not 1.1 < ratio < 1.8: die(f"ring proportions look wrong (outer/inner {ratio:.2f}); check the photo")
    if ro.min() / ro.max() < 0.95: print("  warning: the ring is noticeably oval - the photo may be taken at an angle")
    w = ro - ri; ri, ro = ri + 0.012 * w, ro - 0.018 * w                  # stay just inside both edges: no page white, no dark rim line
    b = BEZEL_BANDS[fam]
    r_in_t = b["r_in"] + b["dy_in"] * np.sin(TH); r_out_t = b["r_out"] + b["dy_out"] * np.sin(TH)
    t = np.clip((RHO - r_in_t) / (r_out_t - r_in_t), 0, 1)
    rs_i = np.interp(TH, np.r_[th, 2 * np.pi], np.r_[ri, ri[0]]); rs_o = np.interp(TH, np.r_[th, 2 * np.pi], np.r_[ro, ro[0]])
    rs = rs_i + t * (rs_o - rs_i)
    mx = (c[0] + np.cos(TH) * rs).astype(np.float32); my = (c[1] + np.sin(TH) * rs).astype(np.float32)
    scale = (b["r_out"] - b["r_in"]) / float(np.mean(ro - ri))
    col = remap(rgb, mx, my, scale)
    alpha = np.clip((RHO - (r_in_t - 0.8)) / 1.6, 0, 1) * np.clip(((r_out_t + 0.8) - RHO) / 1.6, 0, 1)
    print(f"  scaled x{scale:.2f} onto the {fam} insert band ({b['r_in']:.0f}-{b['r_out']:.0f} px)")
    return np.dstack([col, alpha]).astype(np.float32)

# ---------------------------------------------------------------- dial
def fit_dial(rgb, d):
    m = ndi.binary_fill_holes(ndi.binary_opening(d > 40, iterations=2))
    lab, n = ndi.label(m)
    if n == 0: die("could not find the dial in the photo")
    disc = lab == (1 + int(np.argmax(ndi.sum(m, lab, range(1, n + 1)))))
    cs = cv2.findContours(disc.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]
    pts = max(cs, key=cv2.contourArea)[:, 0, :].astype(np.float64)
    A = np.c_[2 * pts[:, 0], 2 * pts[:, 1], np.ones(len(pts))]; bb = (pts ** 2).sum(1)
    cx, cy, k = np.linalg.lstsq(A, bb, rcond=None)[0]; R = np.sqrt(k + cx ** 2 + cy ** 2)
    rms = np.sqrt(np.mean((np.hypot(pts[:, 0] - cx, pts[:, 1] - cy) - R) ** 2))
    print(f"  dial found: centre ({cx:.0f}, {cy:.0f}), radius {R:.0f}, edge fit error {rms:.1f}px")
    if rms > 0.03 * R: die("the dial outline is not a clean circle (shadow, case or strap in the photo?)")
    R_use = R - max(1.5, 0.006 * R)                                       # just inside the edge
    s = R_use / DIAL_R
    mx = (cx + (xx - C) * s).astype(np.float32); my = (cy + (yy - C) * s).astype(np.float32)
    col = remap(rgb, mx, my, 1 / s)
    alpha = np.clip((DIAL_R + 0.8 - RHO) / 1.6, 0, 1)
    print(f"  scaled x{1/s:.2f} to the shared dial size (radius {DIAL_R:.0f} px)")
    return np.dstack([col, alpha]).astype(np.float32)

# ---------------------------------------------------------------- preview
def layer(cat, pid, scale=1.0):
    f = os.path.join(P, cat, pid + ".webp")
    if not os.path.exists(f): return None
    im = Image.open(f).convert("RGBA")
    if scale != 1.0:
        s = int(round(N * scale)); im2 = im.resize((s, s), Image.LANCZOS); im = Image.new("RGBA", (N, N)); im.paste(im2, ((N - s) // 2, (N - s) // 2))
    a = np.array(im).astype(np.float32) / 255; a[..., :3] *= a[..., 3:4]; return a

def compose(layers):
    out = np.zeros((N, N, 4), np.float32); out[..., :3] = 0.07; out[..., 3] = 1
    for l in layers:
        if l is not None: out = l + out * (1 - l[..., 3:4])
    return Image.fromarray((out[..., :3] * 255).astype(np.uint8))

def preview(cat, pid, fams):
    os.makedirs(os.path.join(ROOT, "tools", "previews"), exist_ok=True)
    shots = []
    for fam in fams:
        dft = DEFAULTS.get(fam, DEFAULTS["diver"]); band = BEZEL_BANDS.get(fam, {})
        for case in (dft["case"], dft["gold"]):
            gold = case == dft["gold"]
            fr = layer("frames", band["frame"] + ("@g" if gold else "")) if band.get("frame") else None
            dial = layer("dials", pid if cat == "dials" else dft["dial"], dft["scale"])
            bez = layer("bezels", pid) if cat == "bezels" else None
            shots.append(compose([dial, layer("bracelets", dft["strap"]), layer("cases", case), fr, bez, layer("hands", dft["hands"], dft["scale"])]).crop((250, 150, 1250, 1350)).resize((500, 600)))
            if cat == "dials": break
    W = Image.new("RGB", (500 * len(shots), 600)); [W.paste(s, (500 * i, 0)) for i, s in enumerate(shots)]
    out = os.path.join(ROOT, "tools", "previews", pid + ".png"); W.save(out); return out

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kind", choices=["bezel", "dial"]); ap.add_argument("photo")
    ap.add_argument("--label", required=True, help='name shown on the site, e.g. "Red & White"')
    ap.add_argument("--family", action="append", help="bezels: diver, gmt or satdiver (repeat for several). Dials: ignored")
    ap.add_argument("--id", help="file id (default: made from the label)")
    ap.add_argument("--replace", action="store_true", help="overwrite an existing part with the same id")
    ap.add_argument("--no-gen", action="store_true", help="skip regenerating builds.json")
    a = ap.parse_args()
    reg = json.load(open(os.path.join(B, "registry.json")))
    cat = a.kind + "s"
    if a.kind == "bezel":
        fams = a.family or die("bezels need --family (diver, gmt or satdiver)")
        for f in fams:
            if f not in BEZEL_BANDS: die(f"bezels can be added to: {', '.join(BEZEL_BANDS)} (got '{f}')")
        if len(set(BEZEL_BANDS[f]["r_out"] for f in fams)) > 1: die("Saturation bezels are a different size: add them in a separate command")
        prefix = {"gmt": "bezel-gmt-", "satdiver": "bezel-s-"}.get(fams[0], "bezel-")
    else:
        fams = ["diver"]; prefix = "dial-"
    pid = a.id or prefix + slug(a.label)
    existing = {p["id"]: p for p in reg["parts"]}
    if pid in existing and not a.replace: die(f"a part called '{pid}' already exists (use --replace to overwrite it, or --id to pick another id)")
    clash = [p["id"] for p in reg["parts"] if p["cat"] == cat and p["label"].lower() == a.label.lower() and p["id"] != pid and (a.kind == "dial" or set(p.get("families", [])) & set(fams))]
    if clash: print(f"  warning: '{a.label}' is already the label of {clash} in the same family - customers would see two options with the same name")
    print(f"{a.kind} '{a.label}' -> {cat}/{pid}")
    rgb, d = load_photo(a.photo)
    if a.kind == "bezel": rgba = fit_bezel(rgb, d, fams[0])
    else:
        if (a.family or [None])[0] == "chrono": die("chronograph dials (29.5 mm) need their sub-dial hands made too - not handled by this script")
        rgba = fit_dial(rgb, d)
    pm = rgba.copy(); save(pm, os.path.join(P, cat, pid + ".webp"))
    entry = dict(id=pid, cat=cat, label=a.label)
    if a.kind == "bezel":
        entry.update(families=fams, type={"diver": "diver", "gmt": "gmt", "satdiver": "sat"}[fams[0]])
        if BEZEL_BANDS[fams[0]]["frame"]: entry["frame"] = BEZEL_BANDS[fams[0]]["frame"]
    else: entry["size_mm"] = 28.5
    if pid in existing: reg["parts"][[p["id"] for p in reg["parts"]].index(pid)] = entry
    else:
        last = max([i for i, p in enumerate(reg["parts"]) if p["cat"] == cat and (a.kind == "dial" or set(p.get("families", [])) & set(fams))] or [len(reg["parts"]) - 1])
        reg["parts"].insert(last + 1, entry)
    open(os.path.join(B, "registry.json"), "w").write(json.dumps(reg, separators=(",", ":"), ensure_ascii=False))
    print("  registered in registry.json")
    print("  preview:", preview(cat, pid, fams[:1] if a.kind == "dial" else fams))
    if not a.no_gen:
        try:
            r = subprocess.run(["node", os.path.join(ROOT, "tools", "gen_builds.js")], capture_output=True, text=True, timeout=600)
            print("  " + (r.stdout.strip().splitlines() or ["(no output)"])[-1] if r.returncode == 0 else "  builds.json NOT regenerated: " + r.stderr.strip()[-300:])
        except Exception as e: print("  builds.json NOT regenerated (", e, ") - it is rebuilt on deploy anyway")
    print("done. Nothing committed yet.")

if __name__ == "__main__": main()
