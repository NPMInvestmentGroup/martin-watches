"""Stage 1 site structure: old links forward, builder deep links, order, forms, gallery, phone menus.
Run against a local copy of the built site on :8090 (API mocked, nothing is sent)."""
import json
from playwright.sync_api import sync_playwright
B='http://127.0.0.1:8090'; API='https://martin-watches-api.onrender.com'; sent=[]
def api(r):
    u=r.request.url
    if u.endswith('/inquiry'): sent.append(json.loads(r.request.post_data)); return r.fulfill(status=200,content_type='application/json',body='{"success":true}')
    if '/discount-codes/validate' in u: return r.fulfill(status=200,content_type='application/json',body='{"valid":false}')
    if '/design-meeting' in u: sent.append(json.loads(r.request.post_data)); return r.fulfill(status=200,content_type='application/json',body='{"success":true}')
    if '/watch-prices' in u: return r.fulfill(status=200,content_type='application/json',body='{"womens":500}')
    return r.fulfill(status=404,body='')
ok=[]; ck=lambda c,m:(ok.append(c),print(('PASS ' if c else 'FAIL ')+m))
with sync_playwright() as p:
    b=p.chromium.launch(); errs=[]
    def pg(w=1440):
        x=b.new_page(viewport={'width':w,'height':900}); x.on('pageerror',lambda e: errs.append(str(e))); x.route(API+'/**',api); x.route('https://api.github.com/**',lambda r:r.fulfill(status=404,body='')); return x
    q=pg()
    for old,new in [('/#gallery','/gallery/'),('/#contact','/contact/'),('/#configurator','/build-your-watch/'),('/#how-it-works','/how-it-works/'),('/?family=gmt#configurator','/build-your-watch/?family=gmt'),('/#pricing','/build-your-watch/#pricing')]:
        q.goto(B+old); q.wait_for_timeout(700); ck(q.url==B+new, f'old link {old} -> {q.url.replace(B,"")}')
    q.goto(B+'/'); q.click('.home-hero .btn'); q.wait_for_url('**/build-your-watch/'); ck(True,'hero button opens the builder')
    q.goto(B+'/'); hrefs=q.eval_on_selector_all('.col-grid a','e=>e.map(a=>a.getAttribute("href"))'); ck(hrefs==['/watches/diver/','/build-your-watch/?family=gmt','/build-your-watch/?family=chrono','/build-your-watch/?family=dress','/build-your-watch/?family=womens'],f'collection links {hrefs}')
    ck(q.get_attribute('.design-ctas .btn:nth-child(1)','href')=='/watches/' and q.get_attribute('.design-ctas .btn:nth-child(2)','href')=='/design-meeting/','Explore + design meeting buttons')
    for fam,price in [('gmt','$600'),('womens','$500'),('chrono','$600')]:
        q.goto(B+f'/build-your-watch/?family={fam}'); q.wait_for_function("()=>document.querySelector('.fam[aria-pressed=\"true\"]')",timeout=20000); q.wait_for_timeout(1200)
        ck(q.evaluate("document.querySelector('.fam[aria-pressed=\"true\"]').dataset.id")==fam and q.inner_text('#priceAmount')==price, f'builder opens on {fam} at {price}')
    q.goto(B+'/watches/diver/'); q.click('.hero .btn'); q.wait_for_function("()=>document.querySelector('.fam[aria-pressed=\"true\"]')",timeout=20000)
    ck('/build-your-watch/?family=diver' in q.url and q.evaluate("document.querySelector('.fam[aria-pressed=\"true\"]').dataset.id")=='diver','Diver page button opens builder on Diver')
    q.wait_for_timeout(1000); q.click('text=Place Order & Pay'); q.wait_for_timeout(400)
    for s,v in [('#order-fname','T'),('#order-lname','T'),('#order-email','t@example.com')]: q.fill(s,v)
    q.click('#order-submit-btn'); q.wait_for_timeout(1500)
    ck(sent and sent[-1].get('isOrder') and bool(sent[-1].get('designImage')) and q.locator('a[href="https://venmo.com/u/Quanah-Martin"]').is_visible(),'order sends with picture, Venmo step shows')
    q.goto(B+'/contact/'); q.fill('#fname','A'); q.fill('#lname','B'); q.fill('#email','a@example.com'); q.click('#inquiryForm .form-submit'); q.wait_for_timeout(1000)
    ck(q.is_visible('#formSuccess') and sent[-1].get('email')=='a@example.com','contact inquiry sends')
    q.goto(B+'/gallery/'); q.wait_for_timeout(2500); n=q.eval_on_selector_all('#galleryGrid img','e=>e.length'); q.locator('#galleryGrid img').first.click(); q.wait_for_timeout(500)
    ck(n>900 and q.is_visible('#lightboxImg'),f'gallery shows {n} photos and opens a photo')
    q.goto(B+'/design-meeting/'); q.fill('#name','Q'); q.fill('#phone','2815550100'); q.click('#sendBtn'); q.wait_for_timeout(1000); ck(q.is_visible('#doneView'),'design meeting form works')
    m=pg(390)
    for path in ['/','/build-your-watch/','/gallery/','/contact/','/about/','/watches/','/how-it-works/','/watches/diver/']:
        m.goto(B+path); m.wait_for_timeout(600); m.click('.menu-toggle summary'); m.wait_for_timeout(200)
        vis=m.locator('.menu-toggle .main-nav >> text=Gallery').is_visible()
        ov=m.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
        ck(vis and ov==0, f'phone menu + no sideways scroll on {path}')
    ck(not errs, f'no page errors {errs[:3]}')
    print(f'\n{sum(ok)}/{len(ok)} passed'); b.close()
