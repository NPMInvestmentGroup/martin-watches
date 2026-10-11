"""Redraw the helium-valve ring's lettering crisply (Montserrat SemiBold, from Google Fonts, OFL licence).
The ring's metal is kept from the existing images, with the old soft lettering painted out first."""
import os, numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__)); RINGS = os.path.join(HERE, "..", "images", "builds", "parts", "rings")
N = 1500; C = 750.0
R_IN, R_OUT = 224.0, 264.0                 # ring band (see build notes)
R_TXT, CAP = 243.0, 19.0                   # lettering centre radius and capital height (px)
TRACK = 0.30                               # extra space between letters, as a fraction of the capital height
SS = 4                                     # supersampling
TW = int(round(2 * np.pi * R_TXT)) * SS; TH = int(round(R_OUT - R_IN)) * SS          # polar canvas: x = angle, y = radius (top row = outer edge)
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32); rho = np.hypot(xx - C, yy - C); ang = np.mod(np.arctan2(yy - C, xx - C), 2 * np.pi)

def unwrap(img):
    xs = np.arange(TW // SS, dtype=np.float32) / (TW // SS) * 2 * np.pi; rs = R_OUT - np.arange(TH // SS, dtype=np.float32) - 0.5
    T, R = np.meshgrid(xs, rs); return cv2.remap(img, (C + R * np.cos(T)).astype(np.float32), (C + R * np.sin(T)).astype(np.float32), cv2.INTER_LINEAR)

def clean_metal(rgb, dark_text):
    P = unwrap(rgb.astype(np.float32)); L = P.mean(2)
    med = cv2.medianBlur(L.astype(np.uint8), 31).astype(np.float32)
    txt = (L < med - 18) if dark_text else (L > med + 25)
    txt = cv2.dilate(txt.astype(np.uint8), np.ones((5, 9), np.uint8)) > 0
    th = np.arange(P.shape[1]) / P.shape[1] * 2 * np.pi
    A = np.stack([np.ones_like(th)] + [f(k * th) for k in range(1, 9) for f in (np.cos, np.sin)], 1)
    out = P.copy()
    for row in range(P.shape[0]):
        ok = ~txt[row]
        for c in range(3):
            coef = np.linalg.lstsq(A[ok], P[row, ok, c], rcond=None)[0]; out[row, :, c] = A @ coef
    return out                                                                             # polar, text-free metal

def text_layer(text, centre_deg, upside_down):
    font = ImageFont.truetype(os.path.join(HERE, "fonts", "Montserrat-Variable.ttf"), 10); font.set_variation_by_name("SemiBold")
    cap = font.getbbox("H")[3] - font.getbbox("H")[1]; size = int(round(10 * CAP * SS / cap))
    font = ImageFont.truetype(os.path.join(HERE, "fonts", "Montserrat-Variable.ttf"), size); font.set_variation_by_name("SemiBold")
    widths = [font.getlength(ch) for ch in text]; track = TRACK * CAP * SS; target = sum(widths) + track * (len(text) - 1)
    img = Image.new("L", (int(target + size * 2), TH), 0); d = ImageDraw.Draw(img)
    x = size; capt = font.getbbox("H")[1]; y = (TH - CAP * SS) / 2 - capt
    for ch, wd in zip(text, widths): d.text((x, y), ch, font=font, fill=255); x += wd + track
    m = np.array(img).astype(np.float32) / 255
    if upside_down: m = m[::-1, ::-1]
    full = np.zeros((TH, TW), np.float32); x0 = int(round(centre_deg / 360 * TW - m.shape[1] / 2))
    for i in range(m.shape[1]): full[:, (x0 + i) % TW] = np.maximum(full[:, (x0 + i) % TW], m[:, i])
    return full

def build(name, dark_text, ink):
    a = np.array(Image.open(os.path.join(RINGS, name)).convert("RGBA")).astype(np.float32)
    metal = clean_metal(a[..., :3], dark_text)
    mask = np.maximum(text_layer("HELIUM ESCAPE VALVE", 270.0, False), text_layer("LIMITED EDITION", 90.0, True))
    mask = cv2.resize(mask, (TW // SS, TH // SS), interpolation=cv2.INTER_AREA)            # anti-aliased at final size
    if dark_text: col = metal * (1 - mask[..., None]) + (metal * ink)[...] * mask[..., None]
    else: col = metal * (1 - mask[..., None]) + np.array(ink, np.float32) * mask[..., None]
    # back to the round ring
    x = ang / (2 * np.pi) * (TW // SS); y = (R_OUT - 0.5) - rho
    rgb = cv2.remap(col, x.astype(np.float32), y.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    out = a.copy(); out[..., :3] = np.where(a[..., 3:4] > 0, rgb, a[..., :3])
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA").save(os.path.join(RINGS, name), "WEBP", quality=95, alpha_quality=100, method=6)
    print("redrawn", name)

if __name__ == "__main__":
    build("ring-hev.webp", True, 0.16)          # engraved: the metal's own colour, darkened
    build("ring-hev@g.webp", True, 0.22)
    build("ring-hev@b.webp", False, (222, 222, 222))
