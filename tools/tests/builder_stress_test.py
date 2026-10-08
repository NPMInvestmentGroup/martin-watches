import asyncio, json
from playwright.async_api import async_playwright
B = "http://localhost:8766"
CHECK = "(()=>{const bad=[];for(const cat of FAMS[famId].layers){const el=layerEls[cat],it=chosen[cat];if(!it||!el.src.endsWith(layerSrc(cat,it).replace(/ /g,'%20'))||!el.complete||!el.naturalWidth)bad.push(cat)}return bad})()"
async def settle(page):
    bad = None
    for _ in range(40):                     # up to 4 seconds for the page to finish loading its layers
        await page.wait_for_timeout(100); bad = await page.evaluate(CHECK)
        if not bad: return []
    return bad
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":1400,"height":1000})).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append(str(e))); await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await page.goto(B + "/builder-test.html"); await page.wait_for_selector(".opt"); await page.wait_for_timeout(1200)
        bad_runs = 0
        for fam in ["gmt","chrono","womens","diver","gmt","womens","chrono","gmt"]:          # hammer it: switch and click options straight away
            await page.click(f'.fam[data-id="{fam}"]')
            await page.locator("#opts-dials .opt").nth(2).click()
            await page.locator("#opts-hands .opt").nth(1).click()
            bad = await settle(page)
            if bad: bad_runs += 1; print("  MISMATCH after switching to", fam, bad)
        await page.click('.fam[data-id="gmt"]'); await page.wait_for_timeout(900)
        for _ in range(6):
            await page.click("#btnRandomAny"); bad = await settle(page)
            if bad: bad_runs += 1; print("  MISMATCH after surprise:", bad)
        print("stress test: layers out of sync in", bad_runs, "runs; page errors:", errs)
        await b.close()
asyncio.run(main())
