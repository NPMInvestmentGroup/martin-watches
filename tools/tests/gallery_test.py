"""Curated Gallery: content in the HTML without JavaScript, no customer names or banned wording, photos load,
old photo addresses redirect, filters, viewer and layout on desktop and phone.
Run against a local copy of the built site on :8090 (see Dockerfile steps). Optional: path of the redirect map as argv[1]."""
import json, re, sys, os, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright
B = 'http://127.0.0.1:8090'
HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
data = json.load(open(os.path.join(REPO, 'scripts', 'gallery-curated.json')))
pub = [b for b in data['builds'] if b['status'] == 'published']
ok = []; ck = lambda c, m: (ok.append(bool(c)), print(('PASS ' if c else 'FAIL ') + m))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
opener = urllib.request.build_opener(NoRedirect)
def get(path):
    try: r = opener.open(B + urllib.parse.quote(path, safe='/?=&%')); return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e: return e.code, e.headers, b''

# 1. The HTML as a crawler receives it (no JavaScript)
code, _, raw = get('/gallery/'); html = raw.decode()
cards = re.findall(r'<figure class="gc".*?</figure>', html, re.S)
ck(code == 200 and len(cards) == len(pub), f'{len(cards)} build cards in the HTML (expected {len(pub)} published)')
ck(all(re.search(r'alt="Martin custom [^"]{15,}"', c) for c in cards), 'every card photo has descriptive alt text')
ck(all('class="gc-cap"' in c and 'class="gc-title"' in c for c in cards), 'every card has a title and caption in the HTML')
ck(len(re.findall(r'data-filter="', html)) == 6, '6 collection filters')
ck(not re.search(r'family edition', html, re.I), 'no "Family Edition" wording in the page')
ck('images/Gallery' not in html and 'gallery.json' not in html, 'page uses only the new photo addresses')
# customer names: words from every Gallery folder name that are not watch words must not appear in the page text
folders = {rel.split('/')[-2] for b in data['builds'] for rel in b['photos']}
for root, dirs, _ in os.walk(os.path.join(REPO, 'images', 'Gallery')): folders |= set(dirs)
WATCH = set('''blue green black red pink gold white silver grey gray brown purple rose two tone on and of the diver gmt chrono
 chronograph datejust dress watch watches build first edition wedding his hers gift give away donation coach mom dad set panda
 batman coke pepsi sprite irish colors trade spare mm yacht master face diamond calendar pilot jr martin womans wife son step
 kdk ttu ut lsue a m k s dj mwc photos batch'''.split())
words = {w for f in folders for w in re.findall(r'[A-Za-z]{3,}', f) if w.lower() not in WATCH}
text = re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', ' ', html, flags=re.S))
for n in data.get('approvedPublicNames', []): text = re.sub(re.escape(n), ' ', text, flags=re.I)  # approved business names may appear
found = sorted(w for w in words if re.search(r'\b' + re.escape(w) + r'\b', text, re.I) and w.lower() not in {'trey', 'texas', 'crosby'})
ck(not found, f'no customer names from folder names in the page text {found[:8]}')
approved_slugs = [re.sub(r'[^a-z0-9]+', '-', n.lower()).strip('-') for n in data.get('approvedPublicNames', [])]
def _strip(u):
    for sl in approved_slugs: u = u.lower().replace(sl, ' ')
    return u
names_in_urls = sorted({w for w in words for u in re.findall(r'(?:src|href|data-photos)="([^"]+)"', html) if w.lower() in _strip(u) and w.lower() not in {'trey'}})
ck(not names_in_urls, f'no customer names in photo addresses {names_in_urls[:5]}')

# 2. Every photo loads
urls = set(re.findall(r'src="(/images/gallery-photos/[^"]+)"', html))
for c in cards: urls |= set(json.loads(re.search(r'data-photos="([^"]+)"', c).group(1).replace('&quot;', '"')))
bad = [u for u in urls if get(u)[0] != 200]
ck(not bad, f'all {len(urls)} gallery photos load {bad[:3]}')

# 3. Old addresses
if len(sys.argv) > 1:
    lines = open(sys.argv[1]).read().splitlines(); badr = []
    for l in lines:
        old, new = [x.strip('"') for x in l.rstrip(';').split('" "')]
        c, h, _ = get(old)
        if c != 301 or h['Location'] != new: badr.append(old)
    ck(not badr, f'{len(lines)} old photo addresses redirect permanently to their new photos {badr[:2]}')
ck(get('/gallery.json')[0] == 404, 'old gallery.json (which listed folder names) is gone')

# 4. In the browser: filters, viewer, layout
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    for w, cols in ((1440, 3), (390, 2)):
        q = b.new_page(viewport={'width': w, 'height': 900}); q.on('pageerror', lambda e: errs.append(str(e)))
        q.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
        q.goto(B + '/gallery/'); q.wait_for_timeout(800)
        n = q.evaluate("getComputedStyle(document.querySelector('.gc-grid')).gridTemplateColumns.split(' ').length")
        ov = q.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
        ck(n == cols and ov == 0, f'{w}px: {n} columns, no sideways scroll')
        for k in ['diver', 'gmt', 'chronograph', 'dress', 'womens']:
            q.click(f'.gallery-tab[data-filter={k}]')
            shown = q.evaluate("[...document.querySelectorAll('.gc')].filter(c=>!c.hidden).map(c=>c.dataset.type)")
            ck(shown and all(t == k for t in shown), f'{w}px: {k} filter shows only {k} ({len(shown)})')
        q.click('.gallery-tab[data-filter=all]')
        ck(q.evaluate("[...document.querySelectorAll('.gc')].every(c=>!c.hidden)"), f'{w}px: All Watches shows every build')
        q.locator('.gc-photo').nth(1).click(); q.wait_for_timeout(600)
        cap = q.inner_text('#lightboxCap'); src1 = q.get_attribute('#lightboxImg', 'src'); q.click('.lightbox-next'); q.wait_for_timeout(300)
        ck(q.is_visible('#lightboxImg') and cap.strip() and q.get_attribute('#lightboxImg', 'src') != src1, f'{w}px: viewer opens with caption and steps through the build')
        q.keyboard.press('Escape'); q.close()
    ck(not errs, f'no page errors {errs[:3]}')
    b.close()
print(f'\n{sum(ok)}/{len(ok)} passed')
