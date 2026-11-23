"""Admin page "Add a Part" fitters: make fake photos from the existing parts (on a light background, resized,
turned, with a stray mark), fit them with the admin page's own code, and check size and position come back right.
Run from the repo root: python3 tools/tests/admin_part_fit_test.py"""
import os, re, io, json, base64, threading, http.server, functools, tempfile
import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); P = os.path.join(ROOT, 'images/builds/parts')
tmp = tempfile.mkdtemp()
src = open(os.path.join(ROOT, 'admin.html')).read()
code = src[src.index('// ── WATCH BUILDER: fitting'):src.index('// ── WATCH BUILDER: admin panels')]
open(os.path.join(tmp, 'fit.js'), 'w').write(code)
open(os.path.join(tmp, 'index.html'), 'w').write('<input type=file id=f><script src="fit.js"></script>')
def photo(layers, scale, rot=0, name='p.jpg', mark=True):
    im = Image.new('RGBA', (1500, 1500))
    for l in layers: im.alpha_composite(Image.open(os.path.join(P, l + '.webp')).convert('RGBA'))
    im = im.crop(im.getbbox()); im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    if rot: im = im.rotate(rot, expand=True, resample=Image.BICUBIC)
    bg = Image.new('RGBA', (im.width + 120, im.height + 120), (247, 246, 244, 255)); bg.alpha_composite(im, (60, 60))
    if mark: ImageDraw.Draw(bg).text((bg.width - 40, bg.height - 25), 'X1', fill=(20, 20, 20, 255))
    f = os.path.join(tmp, name); bg.convert('RGB').save(f, quality=92); return f
def alpha_box(png):
    a = np.array(Image.open(io.BytesIO(png)).convert('RGBA'))[:, :, 3] > 128; ys, xs = np.nonzero(a)
    return xs.min(), ys.min(), xs.max(), ys.max()
def ref_box(part):
    a = np.array(Image.open(os.path.join(P, part + '.webp')).convert('RGBA'))[:, :, 3] > 128; ys, xs = np.nonzero(a)
    return xs.min(), ys.min(), xs.max(), ys.max()
cases = [  # (label, js call, photo file, reference part to compare with, tolerance px)
    ('dial', 'fitDial(f)', photo(['dials/dial-blue'], 0.4, 0, 'dial.jpg'), 'dials/dial-blue', 4),
    ('chrono dial', 'fitDial(f)', photo(['dials/dial-chrono-white'], 0.6, 0, 'cdial.jpg'), 'dials/dial-chrono-white', 4),
    ('case (empty)', "fitCase(f,'diver')", photo(['cases/case-stainless'], 0.6, 0, 'case.jpg'), 'cases/case-stainless', 8),
    ('chrono case', "fitCase(f,'chrono')", photo(['cases/case-c-stainless'], 0.5, 0, 'ccase.jpg', False), 'cases/case-c-stainless', 8),
    ('bracelet (sideways)', 'fitBracelet(f)', photo(['bracelets/bracelet-oyster'], 0.8, 90, 'br.jpg'), 'bracelets/bracelet-oyster', 12),
]
fails = 0
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=tmp)
class Q(h.func):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=tmp)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://127.0.0.1:{srv.server_port}/index.html')
    for label, call, f, ref, tol in cases:
        pg.set_input_files('#f', f)
        try:
            url = pg.evaluate("async c => { const f = document.getElementById('f').files[0]; const r = await " + "eval(c)" + "; return r.render({}).toDataURL('image/png'); }", call)
            got, want = alpha_box(base64.b64decode(url.split(',')[1])), ref_box(ref)
            pairs = list(zip(got, want))
            if label.startswith('bracelet'): pairs = pairs[0::2]          # strap: width matters; its far ends fade out
            off = max(abs(int(a) - int(b)) for a, b in pairs); ok = off <= tol; fails += not ok
            print(f"  {'ok  ' if ok else 'FAIL'} {label}: edges within {off}px of the existing part (allowed {tol})")
        except Exception as e: fails += 1; print(f'  FAIL {label}: {str(e)[:160]}')
    b.close()
print('page errors:', errs)
print('admin part fitting:', 'PASS' if not fails and not errs else f'{fails} failed')
