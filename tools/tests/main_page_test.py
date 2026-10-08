from playwright.sync_api import sync_playwright
import json
B="http://localhost:8766"
with sync_playwright() as p:
    b=p.chromium.launch(); errs=[]; bad=[]
    pg=b.new_page(viewport={'width':1440,'height':900})
    pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.on('response',lambda r: bad.append((r.status,r.url)) if r.status>=400 and 'localhost' in r.url else None)
    pg.goto(B+'/index.html'); pg.wait_for_timeout(4000)
    tabs=pg.eval_on_selector_all('#families .fam','els=>els.map(e=>e.innerText.replace(/\\n/g," "))'); print('tabs',tabs)
    for i,t in enumerate(tabs):
        pg.click(f"#families .fam >> nth={i}"); pg.wait_for_function("()=>!document.querySelector(\"#watchStage img.hidden\")", timeout=30000); pg.wait_for_timeout(300)
        n=pg.eval_on_selector_all('#watchStage img:not(.hidden)','e=>e.length'); grp=pg.eval_on_selector_all('#groups .bgroup','e=>e.length')
        print(f"  {t:28s} layers shown {n}/{grp} | {pg.inner_text('#watchNameDisplay')} | {pg.inner_text('#sizeLine')} | {pg.inner_text('#priceAmount')}")
    pg.click('#families .fam >> nth=2'); pg.wait_for_timeout(1500)
    pg.click('#btnRandom'); pg.wait_for_timeout(1500); print('surprise ->', pg.inner_text('#watchSummary'))
    pg.locator('#configurator').scroll_into_view_if_needed(); pg.wait_for_timeout(500)
    pg.evaluate("window.scrollTo(0, document.getElementById('configurator').getBoundingClientRect().top+scrollY+200)"); pg.wait_for_timeout(600); pass
    pg.click('text=Place Order & Pay'); pg.wait_for_timeout(600)
    print('order panel visible:', pg.is_visible('#step-order'), '|', pg.inner_text('#order-build-summary'), '|', pg.inner_text('#order-total'))
    pg.click('#step-order .btn-back'); pg.wait_for_timeout(300); print('back to builder:', pg.is_visible('#step-build'))
    pg.click('text=Send Inquiry'); pg.wait_for_timeout(500)
    print('inquiry family:', pg.eval_on_selector('#formFamily','e=>e.value'), '|', pg.inner_text('#formSummaryText'))
    pg.evaluate('expandWatch()'); pg.wait_for_timeout(500); print('expand layers:', pg.eval_on_selector_all('#watchExpandStage img','e=>e.length')); pg.evaluate('collapseWatch()')
    print('pricing tiers:', pg.eval_on_selector_all('.tier','els=>els.map(e=>e.querySelector(".tier-name").innerText+" "+e.querySelector(".tier-price").innerText)'))
    # mobile
    m=b.new_page(viewport={'width':390,'height':844},device_scale_factor=2); m.on('pageerror',lambda e: errs.append('mobile: '+str(e)))
    m.goto(B+'/index.html'); m.wait_for_timeout(4000); m.locator('#configurator').scroll_into_view_if_needed(); m.wait_for_timeout(800)
    m.evaluate("window.scrollTo(0, document.getElementById('configurator').getBoundingClientRect().top+scrollY+150)"); m.wait_for_timeout(800); pass
    print('page errors:', errs); print('local 4xx:', bad)
    b.close()
