import asyncio, json
from playwright.async_api import async_playwright
B = "http://localhost:8766"
async def main():
    d = json.load(open("/home/claude/martin-watches/builds.json"))["families"]
    print({k: {"dials": len(v["parts"]["dials"]), "hands": len(v["parts"]["hands"])} for k, v in d.items()})
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":1400,"height":1000})).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append(str(e))); await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await page.goto(B + "/builder-test.html#chrono"); await page.wait_for_selector(".opt"); await page.wait_for_timeout(1500)
        for dial in ["Taupe", "White (Gold Subdials)", "Black"]:
            await page.locator('#opts-dials .opt', has_text=dial).first.click(); await page.wait_for_timeout(1200)
            await page.locator('#opts-hands .opt', has_text="Gold Chronograph").first.click(); await page.wait_for_timeout(1200)
            src = await page.evaluate("document.querySelector('.stage img.z-hands').getAttribute('src')"); print(f"dial {dial:24s} -> hands file: {src.split('/')[-1]}")
        # change the dial while keeping the chronograph hands: the hands picture must follow
        await page.locator('#opts-dials .opt', has_text="Ice Blue").first.click(); await page.wait_for_timeout(1500)
        print("after switching to Ice Blue:", (await page.evaluate("document.querySelector('.stage img.z-hands').getAttribute('src')")).split('/')[-1])
        await page.screenshot(path="/tmp/builder_chrono2.png")
        print("page errors:", errs); await b.close()
asyncio.run(main())
