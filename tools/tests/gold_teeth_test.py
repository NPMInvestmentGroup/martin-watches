import asyncio
from playwright.async_api import async_playwright
B = "http://localhost:8766"
BEZ = "(document.querySelector('.stage img.z-frames')||{}).src||''"
EXPECT = "(!FAMS[famId].frame || (document.querySelector('.stage img.z-frames').getAttribute('src') === ((chosen.cases && chosen.cases.goldFrame) ? FAMS[famId].frame.srcGold : FAMS[famId].frame.src))) && (chosen.bezels ? (layerSrc('bezels', chosen.bezels) === document.querySelector('.stage img.z-bezels').getAttribute('src')) : true)"
async def settle(page, n=50):
    for _ in range(n):
        await page.wait_for_timeout(100)
        if await page.evaluate("[...document.querySelectorAll('.stage img')].every(i=>i.complete&&i.naturalWidth>0) && " + EXPECT): return
    print("   (did not settle)")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":1400,"height":1000})).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append(str(e))); await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await page.goto(B + "/builder-test.html#diver"); await page.wait_for_selector(".opt"); await page.wait_for_timeout(1200)
        out = []
        for fam in ["diver", "gmt"]:
            await page.click(f'.fam[data-id="{fam}"]'); await page.wait_for_timeout(900)
            await page.locator('#opts-bezels .opt').nth(3).click(); await settle(page)
            for case in ["Stainless Steel", "Two Tone", "Solid Gold", "Stainless Steel"]:
                await page.locator('#opts-cases .opt', has_text=case).first.click(); await settle(page); src = await page.evaluate(BEZ)
                out.append((fam, case, "gold teeth" if "@g" in src else "steel teeth"))
            # picking a different bezel while a gold case is on keeps the gold teeth version
            await page.locator('#opts-cases .opt', has_text="Solid Gold").first.click(); await settle(page)
            await page.locator('#opts-bezels .opt').nth(5).click(); await settle(page); out.append((fam, "Solid Gold + another bezel", "gold teeth" if "@g" in await page.evaluate(BEZ) else "steel teeth"))
        for o in out: print("  %-5s %-28s -> %s" % o)
        await page.click('.fam[data-id="womens"]'); await page.wait_for_timeout(900)
        print("women's cases offered:", await page.locator('#opts-cases .opt .lbl').all_inner_texts())
        print("page errors:", errs); await b.close()
asyncio.run(main())
