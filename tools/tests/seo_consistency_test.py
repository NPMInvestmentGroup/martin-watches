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
check({"WebSite", "LocalBusiness"} <= types, "WebSite and LocalBusiness present")
biz = next(n for n in ld["@graph"] if n["@type"] == "LocalBusiness")
check(biz["telephone"].replace("-", "").endswith("2818385684") and "281-838-5684" in page, "phone in markup matches the page")
check("streetAddress" not in json.dumps(biz) and "openingHours" not in json.dumps(biz), "no invented street address or hours")
check("aggregateRating" not in json.dumps(ld) and "review" not in json.dumps(ld).lower(), "no ratings or reviews")
check("availability" not in json.dumps(ld), "no invented availability")

# visible pricing cards: name -> price
builder_page = open(f"{ROOT}/build-your-watch/index.html", encoding="utf-8").read()   # pricing cards live on the builder page
cards = {html.unescape(n).strip(): int(p) for n, p in re.findall(
    r'<div class="tier-name">([^<]+)</div>\s*<div class="tier-price"[^>]*>\$(\d+)</div>', builder_page)}
check(len(cards) == 5, f"builder page shows five pricing cards {cards}")
check("Saturation Diver / GMT" not in cards, "hidden Saturation card no longer in the HTML")
markup = {o["itemOffered"]["name"].replace("Martin ", "").replace("Women's Watch", "Women's"): int(o["price"])
          for o in biz["hasOfferCatalog"]["itemListElement"]}
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
check(sorted(biz.get("sameAs", [])) == sorted(SOCIAL), "sameAs lists exactly the three official accounts")
nav = page[page.index('<header class="site-header">'):page.index("</header>")]
foot = page[page.index('<footer class="site-footer">'):page.index("</footer>")]
for name, part in (("nav", nav), ("footer", foot)):
    check(all(part.count(f'href="{u}"') >= 1 for u in SOCIAL), f"{name} links all three social accounts")
links = re.findall(r'<a [^>]*href="https://www\.(?:facebook|instagram|tiktok)\.com[^>]*>', page)
check(all('rel="noopener"' in a and 'target="_blank"' in a and "aria-label" in a for a in links), "social links open safely in a new tab and are labelled")
check("admin.html" not in page, "no Admin link on the public page")
check('class="pricing-tiers" style=' not in builder_page, "pricing cards can stack on phones (no inline column override)")

robots = open(f"{ROOT}/robots.txt").read()
check("Sitemap: https://www.martinwatchco.com/sitemap.xml" in robots, "robots.txt lists the sitemap")
check(not re.search(r"(?im)^disallow:\s*/\s*$", robots), "robots.txt blocks nothing site-wide")
urls = [u.text for u in ET.parse(f"{ROOT}/sitemap.xml").getroot().iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
check(all(u.startswith("https://www.martinwatchco.com/") for u in urls), f"sitemap uses canonical URLs {urls}")
check(not any(x in u for u in urls for x in ("admin", "backup", "test", "api")), "sitemap has no admin, backup, test or API URLs")

print("\nSEO consistency:", "PASS" if not problems else f"{len(problems)} problem(s)")
sys.exit(1 if problems else 0)
