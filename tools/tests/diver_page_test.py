"""Checks for the Custom Diver Watches page (/watches/diver/).
Usage: python3 tools/tests/diver_page_test.py [base_url]   (default http://127.0.0.1:8090, a local copy of the site)
Static checks read the files in the repository; browser checks need the site served at base_url."""
import json, re, sys, os, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8090'
page = open(os.path.join(ROOT, 'watches/diver/index.html'), encoding='utf-8').read()
fams = json.load(open(os.path.join(ROOT, 'images/builds/families.json')))
problems = []
def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok: problems.append(msg)

# ── facts and SEO in the source ──
check(len(re.findall(r'<title>', page)) == 1 and 'Custom Diver Watches' in page.split('</title>')[0], 'one title naming Custom Diver Watches')
check('<link rel="canonical" href="https://www.martinwatchco.com/watches/diver/">' in page, 'canonical is the page itself')
h1 = re.findall(r'<h1[^>]*>(.*?)</h1>', page, re.S)
check(h1 == ['Custom Diver Watches'], 'exactly one H1')
ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page, re.S).group(1))
types = {n['@type'] for n in ld['@graph']}
check({'BreadcrumbList', 'Product'} <= types and 'FAQPage' not in types, 'breadcrumb and product structured data, no FAQ (owner removed it)')
prod = next(n for n in ld['@graph'] if n['@type'] == 'Product')
price = fams['diver']['price']
check(prod['offers']['price'] == str(price) and prod['offers']['priceCurrency'] == 'USD', f'structured-data price = builder price (${price})')
check(page.count(f'${price}') >= 3 and '$500' not in page.replace("Women's <small>33 mm · $500", '').replace('NH05 automatic · $500', ''), 'visible Diver price matches the builder')
check(f"{fams['diver']['size_mm']} mm" in page, 'case size matches the builder data')
text = re.sub(r'<script.*?</script>', ' ', page, flags=re.S)
check('one-year warranty' in text and not re.search(r'two-year|2-year|2 year', text, re.I), 'warranty stated as one year')
for bad, why in [(r'\bUSA\b|made in the U', 'made-in-USA claim'),
                 (r'solid gold', 'solid gold'), (r'review|rating', 'ratings or reviews'), (r'in stock|availability', 'stock claims')]:
    check(not re.search(bad, text, re.I), f'no {why} on the page')
check('availability' not in json.dumps(ld) and 'aggregateRating' not in json.dumps(ld), 'no invented availability or ratings in structured data')
imgs = re.findall(r'(?:src|href)="(/images/[^"]+)"', page) + re.findall(r'(/images/pages/diver/[\w.-]+\.jpg)', page)
missing = sorted({i for i in imgs if not os.path.exists(os.path.join(ROOT, i.lstrip('/')))})
check(not missing, f'every image file exists {missing}')
alts = re.findall(r'<img [^>]*>', page)
check(all(re.search(r'alt="[^"]{10,}"', i) for i in alts), 'every image has descriptive alt text')
check(page.count('href="/build-your-watch/?family=diver"') >= 3, 'Build your Diver buttons go to the Diver builder')
sm = open(os.path.join(ROOT, 'sitemap.xml')).read()
check('<loc>https://www.martinwatchco.com/watches/diver/</loc>' in sm, 'page is in sitemap.xml')
check('href="/watches/diver/"' in open(os.path.join(ROOT, 'index.html')).read(), 'homepage links to the page')

# ── in a browser ──
API = 'https://martin-watches-api.onrender.com'
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 900}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(API + '/**', lambda r: r.fulfill(status=404, body=''))
    pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    resp = pg.goto(BASE + '/watches/diver/')
    check(resp.status == 200, 'page serves with status 200')
    check(pg.request.get(BASE + '/watches/diver', max_redirects=0).status == 301, '/watches/diver redirects to the trailing-slash address')
    pg.wait_for_timeout(800)
    counts = pg.eval_on_selector_all('[data-count]', 'e => e.map(x => x.textContent)')
    built = json.loads(pg.request.get(BASE + '/builds.json').text())['families']['diver']['parts']
    check(counts[0].startswith(str(len(built['dials']))) and counts[1].startswith(str(len(built['bezels']))), f'part counts follow the live builder data {counts}')
    links = set(pg.eval_on_selector_all('a[href^="/"]', 'e => e.map(a => a.getAttribute("href"))'))
    bad = [l for l in sorted(links) if pg.request.get(BASE + l.split('#')[0]).status != 200]
    check(not bad, f'every internal link resolves ({len(links)} checked) {bad}')
    pg.click('.hero .btn'); pg.wait_for_function("() => document.querySelector('.fam.active, .fam[aria-pressed=\"true\"], .fam.selected')", timeout=20000)
    active = pg.evaluate("(document.querySelector('.fam.active, .fam[aria-pressed=\"true\"], .fam.selected')||{}).dataset.id")
    pg.wait_for_timeout(1500)
    top = pg.evaluate("document.getElementById('configurator').getBoundingClientRect().top")
    check(active == 'diver' and abs(top) < 200, f'Build your Diver opens the builder on Diver (family={active}, section top={round(top)})')
    for w in [320, 375, 390, 414, 600, 768, 834, 1024, 1280, 1440]:
        q = b.new_page(viewport={'width': w, 'height': 900}); q.route(API + '/**', lambda r: r.fulfill(status=404, body=''))
        q.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
        q.goto(BASE + '/watches/diver/'); over = q.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        if over: problems.append(f'sideways scroll {over}px at {w}px')
        if w == 390:
            q.click('.menu-toggle summary'); q.wait_for_timeout(200)
            check(q.is_visible('.menu-toggle .main-nav >> text=Gallery'), 'phone menu opens and shows the links')
            q.click('.menu-toggle summary:has-text("Watches")'); q.wait_for_timeout(200)
            check(q.is_visible('.menu-toggle >> text=Chronograph'), 'phone Watches list opens')
        q.close()
    check(not [x for x in problems if x.startswith('sideways')], 'no sideways scroll from 320 to 1440 px')
    check(not errs, f'no page errors {errs}')
    b.close()

print('\nDiver page:', 'PASS' if not problems else f'{len(problems)} problem(s)')
sys.exit(1 if problems else 0)
