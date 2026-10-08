import asyncio, json, urllib.request
from playwright.async_api import async_playwright
B = "http://localhost:8766"
async def main():
    # 1) every file the manifest points to must exist
    data = json.load(urllib.request.urlopen(B + "/builds.json"))["families"]
    urls = set()
    for f in data.values():
        for cat, items in f["parts"].items():
            for it in items: urls.add(it["thumb"]); urls.add(it["src"])
    missing = []
    for u in sorted(urls):
        try: urllib.request.urlopen(B + "/" + u.replace(" ", "%20"))
        except Exception as e: missing.append((u, str(e)[:40]))
    print(f"manifest check: {len(urls)} files referenced, {len(missing)} missing", missing[:5])
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={"width":1400,"height":1000}); page = await ctx.new_page()
        errs, bad = [], []
        page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
        page.on("response", lambda r: bad.append((r.status, r.url)) if r.status >= 400 and "fonts.g" not in r.url else None)
        await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await page.goto(B + "/builder-test.html"); await page.wait_for_selector(".opt", timeout=15000); await page.wait_for_timeout(1200)
        tabs = await page.locator(".fam").all_inner_texts(); print("family tabs:", [t.replace("\n"," ") for t in tabs])
        for fid, f in data.items():
            await page.click(f'.fam[data-id="{fid}"]'); await page.wait_for_function("(n)=>document.getElementById('sizeLine').textContent.length>0 && document.querySelectorAll('.stage img:not(.hidden)').length>=n", arg=len(f["layers"])); await page.wait_for_timeout(600)
            shown = await page.evaluate("[...document.querySelectorAll('.stage img')].filter(i=>!i.classList.contains('hidden')&&i.complete&&i.naturalWidth>0).length")
            groups = await page.evaluate("[...document.querySelectorAll('.group-title h2')].map(h=>h.textContent)")
            opts = await page.locator(".opt").count()
            print(f"  {fid:7s} layers on stage {shown}/{len(f['layers'])} | groups {groups} | options {opts} | size line '{await page.inner_text('#sizeLine')}' | price {await page.inner_text('#price')}")
        # click through every option in the GMT family: each must produce a decoded image
        await page.click('.fam[data-id="gmt"]'); await page.wait_for_timeout(700)
        fails = 0
        for cat, items in data["gmt"]["parts"].items():
            for it in items:
                await page.locator(f'#opts-{cat} .opt[data-id="{it["id"]}"]').click(); await page.wait_for_timeout(60)
        await page.wait_for_timeout(800)
        ok = await page.evaluate("[...document.querySelectorAll('.stage img')].every(i=>i.complete&&i.naturalWidth>0)")
        print("clicked every GMT option; all layers still decoded:", ok)
        await page.click("#btnRandom"); await page.wait_for_timeout(900); print("surprise (same family):", await page.inner_text("#buildName"), "|", await page.inner_text("#sizeLine"))
        seen=set()
        for _ in range(8):
            await page.click("#btnRandomAny"); await page.wait_for_timeout(700); seen.add((await page.inner_text("#sizeLine")))
        print("surprise any family -> sizes seen:", sorted(seen))
        await page.click('.fam[data-id="gmt"]'); await page.locator('#opts-bezels .opt', has_text="Blue & Red").first.click(); await page.locator('#opts-gmthands .opt', has_text="Red").first.click(); await page.wait_for_timeout(1200)
        await page.screenshot(path="/tmp/builder_gmt.png")
        await page.click('.fam[data-id="chrono"]'); await page.wait_for_timeout(1200); await page.screenshot(path="/tmp/builder_chrono.png")
        m = await b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2); mp = await m.new_page(); await mp.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await mp.goto(B + "/builder-test.html#womens"); await mp.wait_for_selector(".opt"); await mp.wait_for_timeout(1500); await mp.screenshot(path="/tmp/builder_womens_mobile.png")
        print("page errors:", errs); print("failed requests:", bad[:5])
        await b.close()
asyncio.run(main())
