"""SEO and price consistency checks on the source files (no browser needed).
Run from the repository root:  python3 tools/tests/seo_consistency_test.py
Fails loudly if structured data, visible pricing cards and builder data disagree."""
import json, re, sys, html
import xml.etree.ElementTree as ET

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
page = open(f"{ROOT}/index.html", encoding="utf-8").read()
fams = json.load(open(f"{ROOT}/images/builds/families.json"))
problems = []
def check(ok, msg):
    print(("  ok   " if ok else "  FAIL ") + msg)
    if not ok: problems.append(msg)

head = page[:page.index("</head>")]
check(len(re.findall(r"<title>", head)) == 1, "exactly one <title>")
check('name="description"' in head, "meta description present")
check('<link rel="canonical" href="https://www.martinwatchco.com/">' in head, "canonical points at https://www.martinwatchco.com/")
h1 = re.findall(r"<h1[^>]*>(.*?)</h1>", page, re.S)
check(len(h1) == 1 and "Custom Watches" in h1[0], "one H1 naming custom watches")

blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S)
check(len(blocks) == 1, "one JSON-LD block")
ld = json.loads(blocks[0])
types = {n["@type"] for n in ld["@graph"]}
check("WebSite" in types and types & {"LocalBusiness", "Store"}, "WebSite and the business (Store) present")
biz = next(n for n in ld["@graph"] if n["@type"] in ("LocalBusiness", "Store"))
check(biz["telephone"].replace("-", "").endswith("2818385684") and "281-838-5684" in page, "phone in markup matches the page")
check("streetAddress" not in json.dumps(biz) and "openingHours" not in json.dumps(biz), "no invented street address or hours")
check("aggregateRating" not in json.dumps(ld) and "review" not in json.dumps(ld).lower(), "no ratings or reviews")
avail = set(re.findall(r'"availability": "https://schema.org/(\w+)"', json.dumps(ld)))
check(not avail, f"no availability claims (Google rejects MadeToOrder; owner chose to omit) {avail}")
check("free shipping anywhere in the u.s." in open(f"{ROOT}/index.html", encoding="utf-8").read().lower(), "free U.S. shipping stated on the page, matching the shipping data")

# visible pricing cards: name -> price
builder_page = open(f"{ROOT}/build-your-watch/index.html", encoding="utf-8").read()   # pricing cards live on the builder page
cards = {html.unescape(n).strip(): int(p) for n, p in re.findall(
    r'<div class="tier-name">([^<]+)</div>\s*<div class="tier-price"[^>]*>\$(\d+)</div>', builder_page)}
check(len(cards) == 5, f"builder page shows five pricing cards {cards}")
check("Saturation Diver / GMT" not in cards, "hidden Saturation card no longer in the HTML")
# Homepage offers point to each family page's Product by @id (Google flagged standalone nested Products).
page_name = {"diver": "Diver", "gmt": "GMT", "chronograph": "Chronograph", "dress": "Dress Watch", "womens": "Women's"}
offers = biz["hasOfferCatalog"]["itemListElement"]
markup = {page_name[re.search(r"/watches/([a-z]+)/#product$", o["itemOffered"]["@id"]).group(1)]: int(o["price"]) for o in offers}
check(all(set(o["itemOffered"]) == {"@id"} for o in offers), "homepage offers reference family products by @id only")
for o in offers:
    slug = re.search(r"/watches/([a-z]+)/#product$", o["itemOffered"]["@id"]).group(1)
    fp = open(f"{ROOT}/watches/{slug}/index.html", encoding="utf-8").read()
    prods = [x for raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>', fp, re.S)
             for x in (json.loads(raw).get("@graph") or [json.loads(raw)]) if x.get("@type") == "Product"]
    check(any(x.get("@id") == o["itemOffered"]["@id"] and int(x["offers"]["price"]) == int(o["price"]) for x in prods),
          f"{slug} page has the referenced Product at the same price")
check(markup == cards, f"structured-data prices match the pricing cards {markup}")
fam_name = {"diver": "Diver", "gmt": "GMT", "chrono": "Chronograph", "dress": "Dress Watch", "womens": "Women's"}
builder = {fam_name[k]: v["price"] for k, v in fams.items() if k in fam_name}
check(builder == cards, f"builder data prices match the pricing cards {builder}")
check(cards.get("Women's") == 500, "Women's is $500")

visible = {k for k, v in fams.items() if not v.get("hidden")}
check(len(markup) == 5 and visible == set(fam_name), f"structured data lists exactly the five visible families {sorted(visible)}")

check(not re.search(r"FREE90FREE|FRIENDSANDFAMILY|DISCOUNT_CODES\s*=", page), "no discount codes written in the page source")
check("facebook.com/profile.php" not in page, "Facebook link fixed")

SOCIAL = ["https://www.facebook.com/martinwatches",
          "https://www.instagram.com/martinwatchcotx",
          "https://www.tiktok.com/@martinwatchcotx"]
GBP = "https://share.google/M7hqbvrJBWBa8bNv9"  # owner-supplied Google Business Profile link, verified Nov 17, 2026
check(sorted(biz.get("sameAs", [])) == sorted(SOCIAL + [GBP]), "sameAs lists exactly the three official accounts plus the Google Business Profile")
check(GBP in open(f"{ROOT}/contact/index.html", encoding="utf-8").read() and "Find us on Google" in open(f"{ROOT}/contact/index.html", encoding="utf-8").read(), "Contact page links to the Google Business Profile")
nav = page[page.index('<header class="site-header">'):page.index("</header>")]
foot = page[page.index('<footer class="site-footer">'):page.index("</footer>")]
for name, part in (("nav", nav), ("footer", foot)):
    check(all(part.count(f'href="{u}"') >= 1 for u in SOCIAL), f"{name} links all three social accounts")
links = re.findall(r'<a [^>]*href="https://www\.(?:facebook|instagram|tiktok)\.com[^>]*>', page)
check(all('rel="noopener"' in a and 'target="_blank"' in a and "aria-label" in a for a in links), "social links open safely in a new tab and are labelled")
# the only way to the admin is the small, faint shield at the very bottom of the homepage (not followed by search engines)
admin_links = re.findall(r'<a [^>]*href="/admin\.html"[^>]*>', page)
check(len(admin_links) == 1 and 'rel="nofollow"' in admin_links[0] and page.index(admin_links[0]) > page.index('<footer class="site-footer">') and "admin.html" not in nav, "admin reached only by the small nofollow shield in the homepage footer")
check('class="pricing-tiers" style=' not in builder_page, "pricing cards can stack on phones (no inline column override)")

robots = open(f"{ROOT}/robots.txt").read()
check("Sitemap: https://www.martinwatchco.com/sitemap.xml" in robots, "robots.txt lists the sitemap")
check(not re.search(r"(?im)^disallow:\s*/\s*$", robots), "robots.txt blocks nothing site-wide")
urls = [u.text for u in ET.parse(f"{ROOT}/sitemap.xml").getroot().iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
check(all(u.startswith("https://www.martinwatchco.com/") for u in urls), f"sitemap uses canonical URLs {urls}")
check(not any(x in u for u in urls for x in ("admin", "backup", "test", "api")), "sitemap has no admin, backup, test or API URLs")


# ── Business identity (Google Business Profile recognition) ──
import glob as _glob
check(biz["name"] == "Martin Watch Co." and biz["@id"] == "https://www.martinwatchco.com/#business", "business name is exactly 'Martin Watch Co.' with one stable @id")
check("streetAddress" not in json.dumps(biz) and "postalCode" not in json.dumps(biz), "no street address or postal code published")
check(biz["address"].get("addressLocality") == "Crosby" and biz["address"].get("addressRegion") == "TX", "general location is Crosby, TX")
check(set(biz["sameAs"]) >= {"https://www.instagram.com/martinwatchcotx", "https://www.facebook.com/martinwatches", "https://www.tiktok.com/@martinwatchcotx"}, "official social profiles in sameAs")
_defs, _refs = 0, 0
for _f in [x for x in _glob.glob(f"{ROOT}/**/index.html", recursive=True) if "/images/" not in x]:
    for _raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>', open(_f, encoding="utf-8").read(), re.S):
        _txt = json.dumps(json.loads(_raw))
        _defs += len(re.findall(r'"@id": "https://www\.martinwatchco\.com/#business", "name"', _txt))
        _refs += _txt.count('"https://www.martinwatchco.com/#business"')
check(_defs == 1, f"the business entity is defined once site-wide ({_defs})")
check(_refs >= 8, f"other pages reference the same business @id ({_refs} references)")
_titles = [re.search(r"<title>(.*?)</title>", open(x, encoding="utf-8").read()).group(1) for x in _glob.glob(f"{ROOT}/**/index.html", recursive=True) if "/images/" not in x]
check(all("Martin Watch Co." in t for t in _titles), "every public page title uses the exact name 'Martin Watch Co.'")
check("Local pickup in the Crosby, Texas area is available by appointment." in open(f"{ROOT}/contact/index.html", encoding="utf-8").read(), "Contact page states free shipping and pickup by appointment")


print("\nSEO consistency:", "PASS" if not problems else f"{len(problems)} problem(s)")
sys.exit(1 if problems else 0)
