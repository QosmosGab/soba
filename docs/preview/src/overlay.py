"""Soba overlay on the nexura.framer.ai mirror: logo + copy, applied in the HTML (first paint)
and again at runtime after Framer hydrates (Framer repaints its own text otherwise)."""
import re, html, json, urllib.parse, pathlib
import os
ROOT = pathlib.Path(__file__).parent
import sys, subprocess, shutil
PAGES = ['home', 'contact', 'privacy', 'terms', 'messaging', '404']
PAGE = sys.argv[1] if len(sys.argv) > 1 else 'home'
if PAGE == 'all':
    for pg in PAGES: subprocess.run([sys.executable, __file__, pg], check=True)
    sys.exit(0)
LEGAL = PAGE in ('privacy', 'terms', 'messaging', '404')
SRC = 'mirror.html' if PAGE == 'home' else 'mirror-contact.html'
OUT = {'home': 'v1.html', 'contact': 'contact.html'}.get(PAGE, PAGE + '.html')
SITE = ROOT.parent.parent  # docs/
DEPLOY = SITE/('index.html' if PAGE == 'home' else OUT)
h = (ROOT/SRC).read_text(encoding="utf-8")
# The published shell is static HTML. Its original app bundle restores the
# template content and can unmount edited sections when a breakpoint changes.
# Keep its layout CSS and appearance effects; use our small layer for behavior.
h = re.sub(r'<script\b[^>]*data-framer-bundle="main"[^>]*>.*?</script>', '', h, flags=re.S)
h = re.sub(r'<link\b[^>]*rel="modulepreload"[^>]*>', '', h)
LEGAL_HTML = LEGAL_H1 = LEGAL_DATE = LEGAL_DESC = None
if PAGE == '404':
    LEGAL_DESC = 'That page moved or never existed.'
    LEGAL_H1 = 'Nothing here.'
    LEGAL_DATE = 'That page moved or never existed.'
    LEGAL_HTML = '<p class="sb-404"><a href="/">Back to the home page</a><span>&middot;</span><a href="/contact">Contact us</a></p>'
elif LEGAL:
    lsrc = (SITE/'src'/(PAGE + '.html')).read_text(encoding='utf-8')
    LEGAL_DESC = re.search(r'<meta name="description" content="([^"]*)"', lsrc).group(1)
    LEGAL_H1 = re.search(r'<h1>(.*?)</h1>', lsrc, re.S).group(1).strip()
    LEGAL_DATE = re.search(r'<p class="muted">(.*?)</p>', lsrc, re.S).group(1).strip()
    body = lsrc[lsrc.find('</p>', lsrc.find('<p class="muted">')) + 4:]
    body = body[:body.rfind('</main>')] if '</main>' in body else body
    LEGAL_HTML = body.strip()
TITLE = {'home': 'Soba — Practical AI for distributors', 'contact': 'Contact - Soba', '404': 'Page not found - Soba'}.get(PAGE, (LEGAL_H1 or '') + ' - Soba')
OGTITLE = {'home': 'Soba — More time selling. Less time on busywork.', 'contact': 'Contact Soba'}.get(PAGE, TITLE)
CANON = 'https://usesoba.com/' + ('' if PAGE == 'home' else PAGE)

CONTACT_MAP = [
 ("Start the conversation. We're ready to help.", "Tell us about your business."),
 ("Let's talk about what intelligent automation can do for your business. Tell us where you're at and we'll figure out the rest.",
  "Tell us what you sell and where your team loses the most time. We reply within one business day."),
 ("What best describes you?", "What kind of operation?"),
 ("Marketing Agency", "Grower-shipper"), ("In-house Marketing Team", "Importer"), ("AI Consultant", "Wholesaler"), ("Startup Founder", "Distributor"),
 ("Where are you in your journey?", "Where does your team lose the most time?"),
 ("Just researching", "Sales and follow-ups"), ("Evaluating tools / comparing options", "Order entry"), ("Already have a solution, looking to switch", "Operations and reporting"),
 ("Anything else you'd like us to know?", "Message"),
 ("Send message", "Send"),
 ("Got a question? We'll get back to you within 24 hours.", "Got a question? We reply within one business day. Project Peach Inc. · 575 Fifth Avenue, New York, NY 10017 · (480) 819-8035"),
 ("hello@nexura.ai", "Send an email"),
 ("Join the community", "Book a demo"),
 ("Stay up to date with product news, tips, and updates.", "Thirty minutes on a call to find where AI saves your team the most."),
 ("Follow us on X", "Pick a time"),
 ("Talk to sales", "Text or call"),
 ("Prefer to talk it out? Our team is available Mon\u2013Fri, 9am\u20136pm.", "Prefer to talk it out? Text or call and a founder picks up."),
 ("+1 (800) 123-4567", "Text us"),
 ("Can I switch plans or cancel anytime?", "Does Soba speak Spanish?"),
 ("Absolutely. All plans are flexible with no long-term contracts. You can upgrade, downgrade, or cancel at any time.",
  "Yes. Everything we build works in English and Spanish."),
 ("Do you offer custom or enterprise pricing?", "Will AI make commitments for us?"),
 ("Yes. If your team has specific needs, reach out via the form or book a call with sales and we'll put together a custom plan.",
  "No. It works inside the rules you set. Anything outside them goes to a person on your team first."),
 ("How quickly will I hear back after submitting the form?", "Do we need to change our systems?"),
 ("We typically respond within 1 business day. For urgent inquiries, feel free to email us directly.",
  "No. We build on top of your ERP, email, phones and WhatsApp."),
 ("What kind of support is included with my plan?", "How do we get started?"),
 ("All plans include access to our help center and email support. Pro and Enterprise plans get priority support and a dedicated account manager.",
  "A 30-minute call. We look at where your team spends its time and pick the first thing to automate."),
 ("Can I integrate Nexura with my marketing tools?", "Who is Soba for?"),
 ("Yes \u2014 Nexura connects with a wide range of tools including CRMs, email platforms, and analytics software. Check our integrations page for the full list.",
  "Grower-shippers, importers, wholesalers and distributors."),
]

MAP = [
 ("Product", "What we build"), ("Pricing", "How we work"), ("Integration", "How we work"),
 ("Resources", "Company"), ("Get started", "Talk to us"),
 ("New Release Available", "AI for distributors"),
 ("Scale faster with your AI Agent", "More time selling. Less time on busywork."),
 ("Spend less time on logistics and more on strategy while Nexura handles the execution of your global marketing operations.",
  "We build practical AI tools that help your team find sales opportunities, follow up with customers, and put quotes together. Built around the way you already work."),
 ("Start for free", "Talk to us"), ("Talk to sales", "See examples"),
 ("Connects with your existing stack.", "Built around how you work."),
 ("Nexura plugs into the tools your team already uses — no migration required.",
  "Start with one task your team already does. We build a first version around your emails, spreadsheets, and systems."),
 ("Explore 50+ supported integrations", "Show us one repetitive task"),
 ("Securely link your account", "We build the first version free"),
 ("Sync and streamline your workflow", "Your team tries it and shapes what comes next"),
 ("Explore all integrations", "Talk to us"),
 ("Your best-performing campaign starts here.", "Start with one workflow."),
 ("Set up in minutes. See results from day one.", "Show us where your team gets bogged down. We’ll build the first version free."),
 ("The AI agent built for modern marketing teams.", "Practical AI for distributors."),
 ("Platform", "Soba"), ("Demo", "Talk to us"), ("Blog", "What we build"), ("Solutions", "How we work"),
 ("Terms of Services", "Terms"), ("Privacy Policy", "Privacy"),
 ("Designed by Lunis. All rights reserved.", "© 2026 Project Peach Inc., doing business as Soba AI"),
 ("Nexura", "soba"),
]
if PAGE == 'contact': MAP = CONTACT_MAP + MAP
if LEGAL: MAP = [("Contact", "404" if PAGE == '404' else "Legal"), ("Start the conversation. We're ready to help.", LEGAL_H1), ("Let's talk about what intelligent automation can do for your business. Tell us where you're at and we'll figure out the rest.", LEGAL_DATE)] + CONTACT_MAP + MAP
MAP = [(a, b) for a, b in MAP if a != b]

# ---- HTML pre-pass (first paint)
def norm(s):
    s = html.unescape(s); s = re.sub(r'\s+', ' ', s).strip(); s = re.sub(r' ([,.!?;:])', r'\1', s); return s
parts = re.split(r'(<[^>]+>)', h)
def text_indices():
    out = []; in_skip = False
    for i in range(len(parts)):
        if i % 2 == 1:
            t = parts[i].lower()
            if t.startswith('<style') or t.startswith('<script'): in_skip = True
            elif t.startswith('</style') or t.startswith('</script'): in_skip = False
        elif parts[i].strip() and not in_skip: out.append(i)
    return out
counts = {}
for old, new in MAP:
    o = norm(old); oc = o.replace(' ', ''); maxlen = max(len(o.split(' ')) + 2, len(oc) + 2)
    tix = text_indices(); j = 0
    while j < len(tix):
        for L in range(1, min(maxlen, len(tix) - j) + 1):
            seg = [parts[tix[j+k]] for k in range(L)]
            charmode = all(len(norm(s)) == 1 for s in seg)
            joined = norm(''.join(seg)).replace(' ', '') if charmode else norm(' '.join(seg))
            target = oc if charmode else o
            if joined == target:
                out = []
                if charmode:
                    groups = [[0]]
                    for k in range(1, L):
                        between = parts[tix[j+k-1]+1:tix[j+k]]
                        if any(i2 % 2 == 0 and b and not b.strip() for i2, b in zip(range(tix[j+k-1]+1, tix[j+k]), between)): groups.append([k])
                        else: groups[-1].append(k)
                    words = new.split(' '); out = [''] * L
                    for gi, g in enumerate(groups):
                        w = words[gi] if gi < len(words) else ''
                        if gi == len(groups) - 1 and len(words) > len(groups): w = ' '.join(words[gi:])
                        for n2, k in enumerate(g):
                            piece = (w[n2] if n2 < len(w) else '') if n2 < len(g) - 1 else w[n2:]
                            out[k] = html.escape(piece, quote=False)
                else:
                    words = new.split(' '); origc = [len(norm(s).split(' ')) for s in seg]; pos = 0
                    for k in range(L):
                        take = origc[k] if k < L-1 else len(words) - pos
                        chunk = words[pos:pos+take]; pos += take
                        lead = re.match(r'\s*', seg[k]).group(0); trail = re.search(r'\s*$', seg[k]).group(0)
                        txt = ' '.join(chunk)
                        if chunk and k > 0 and not lead and not seg[k].strip()[:1].isalnum() and txt[:1].isalnum() and not out[-1].endswith(' '): txt = ' ' + txt
                        out.append(lead + html.escape(txt, quote=False) + trail if chunk else lead + trail)
                for k in range(L): parts[tix[j+k]] = out[k]
                counts[old] = counts.get(old, 0) + 1
                j += L - 1; break
            if len(joined) > len(target): break
        j += 1
h = ''.join(parts)
print("html runs replaced:", sum(counts.values()), "| not found:", [o for o, _ in MAP if o not in counts])

# ---- logo + badge + runtime overlay
CL = ''.join(f'<path d="M0 0 Q-15 -11 0 -27 Q15 -11 0 0 Z" fill="none" stroke="#0B1A2B" stroke-width="4.5" stroke-linejoin="round" transform="rotate({r})"/>' for r in (0,120,240))
clover = "data:image/svg+xml," + urllib.parse.quote(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="translate(32 36)">{CL}</g></svg>', safe="")
CLW = CL.replace('#0B1A2B', '#ffffff')
clover_w = "data:image/svg+xml," + urllib.parse.quote(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="translate(32 36)">{CLW}</g></svg>', safe="")
style = f'''<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@700&display=swap" rel="stylesheet">
<style id="soba-overlay">
#__framer-badge-container,.__framer-badge,.framer-19k8402-container{{display:none!important}}
[data-framer-name="Testimonial Section"],[data-framer-name="Pricing Section"],.framer-ynrokg-container,.framer-1kuhljk-container{{display:none!important}}
[data-framer-component-type="SVG"][data-framer-name="Logo"] svg{{display:none!important}}
[data-framer-component-type="SVG"][data-framer-name="Logo"] .svgContainer{{background:url("{clover}") center/contain no-repeat}}
footer [data-framer-component-type="SVG"][data-framer-name="Logo"] .svgContainer,[data-framer-name="Footer"] [data-framer-component-type="SVG"][data-framer-name="Logo"] .svgContainer{{background-image:url("{clover_w}")}}
h6.framer-styles-preset-tdvpcf{{font-family:Quicksand,sans-serif!important;font-weight:700!important;letter-spacing:-.02em}}
</style>'''
script = '''<script id="soba-runtime">(function(){
const MAP=%s;
const norm=s=>s.replace(/\\s+/g,' ').replace(/ ([,.!?;:])/g,'$1').trim();
let busy=false, obs;
function scope(recs){ if(!recs||!recs.length) return [document.body]; const set=new Set(); for(const r of recs){ let t=r.target; if(t.nodeType===3) t=t.parentNode; if(t&&t.nodeType===1) set.add(t); } const roots=[...set].filter(a=>![...set].some(b=>b!==a&&b.contains(a))); return roots.length?roots:[document.body]; }
function run(recs){ if(busy) return; busy=true; if(obs) obs.disconnect();
  try{
    const nodes=[]; for(const root of scope(recs)){ const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>{const p=n.parentNode;if(!p||p.nodeName==='SCRIPT'||p.nodeName==='STYLE'||!n.nodeValue.trim())return NodeFilter.FILTER_REJECT;return NodeFilter.FILTER_ACCEPT}}); while(w.nextNode()) nodes.push(w.currentNode); }
    for(const [old,nw] of MAP){ const o=norm(old), oc=o.replace(/ /g,''); const maxlen=Math.max(o.split(' ').length+2, oc.length+2);
      for(let j=0;j<nodes.length;j++){ if(!nodes[j].nodeValue.trim()) continue;
        for(let L=1;L<=Math.min(maxlen,nodes.length-j);L++){ const seg=[]; for(let k=0;k<L;k++) seg.push(nodes[j+k].nodeValue);
          const cm=seg.every(s=>norm(s).length===1); const joined=cm?norm(seg.join('')).replace(/ /g,''):norm(seg.join(' ')); const target=cm?oc:o;
          if(joined===target){ if(cm){ const wordOf=n=>n.parentElement&&(n.parentElement.closest('[data-tw-word]')||n.parentElement.parentElement); const groups=[[0]]; for(let k=1;k<L;k++){ if(wordOf(nodes[j+k])===wordOf(nodes[j+k-1])) groups[groups.length-1].push(k); else groups.push([k]); } const words=nw.split(' '); groups.forEach((g,gi)=>{ let w=gi<words.length?words[gi]:''; if(gi===groups.length-1&&words.length>groups.length) w=words.slice(gi).join(' '); g.forEach((k,n2)=>{ const piece=n2<g.length-1?(w[n2]||''):w.slice(n2); nodes[j+k].nodeValue=piece; }); }); }
            else { const words=nw.split(' '); const origc=seg.map(s=>norm(s).split(' ').length); let pos=0; for(let k=0;k<L;k++){ const take=k<L-1?origc[k]:words.length-pos; const chunk=words.slice(pos,pos+take); pos+=take; const lead=(seg[k].match(/^\\s*/)||[''])[0], trail=(seg[k].match(/\\s*$/)||[''])[0]; let t=chunk.join(' '); if(chunk.length&&k>0&&!lead&&!/^[A-Za-z0-9]/.test(seg[k].trim())&&/^[A-Za-z0-9]/.test(t)&&!/ $/.test(nodes[j+k-1].nodeValue)) t=' '+t; nodes[j+k].nodeValue=lead+t+trail; } }
            j+=L-1; break; }
          if(joined.length>target.length) break; } } }
    document.title=window.SB_TITLE||document.title; if(window.sobaLayer) window.sobaLayer();
    [...document.querySelectorAll('h1,h2,h3')].filter(e=>/Book a demo, or just ask/.test(e.textContent)).forEach(e=>{let c=e;for(let i=0;i<7&&c.parentElement;i++)c=c.parentElement; const w2=document.createTreeWalker(c,NodeFilter.SHOW_TEXT); while(w2.nextNode()){ if(w2.currentNode.nodeValue.trim()==='Contact us') w2.currentNode.nodeValue=w2.currentNode.nodeValue.replace('Contact us','Ask a question'); }});
    [...document.querySelectorAll('a')].filter(a=>a.textContent.trim()==='Pricing').forEach(a=>{(a.closest('[class*="-container"]')||a).style.display='none'});
  } finally { busy=false; if(obs) obs.observe(document.body,{childList:true,subtree:true,characterData:true}); }
}
// Synchronous on purpose: Framer's bundle fails hydration (our copy differs from its props) and client-renders the whole template; the observer callback runs in the microtask before the browser paints, so the template DOM is never shown.
obs=new MutationObserver(recs=>run(recs));
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>{run();}); else run();
window.addEventListener('load',()=>{run(); setTimeout(run,800); setTimeout(run,2500)});
})();</script>''' % json.dumps(MAP, ensure_ascii=False)
pos = 0; kc = 0
while True:
    i = h.find('Book a demo, or just ask a question', pos)
    if i < 0: break
    j = h.find('>Contact us<', i)
    if j > 0 and j - i < 30000: h = h[:j] + '>Ask a question<' + h[j+12:]; kc += 1
    pos = i + 10
print("cta buttons retitled:", kc)
style += '<style id="soba-css">' + (ROOT/'soba.css').read_text() + '</style>'
style += '<template id="sb-use-cases-template">' + (ROOT/'use-cases.html').read_text() + '</template>'
style += '<template id="sb-workflow-template">' + (ROOT/'workflow.html').read_text() + '</template>'
if LEGAL:
    style += '<style id="soba-legal-hide">[data-framer-name="Form Section"],[data-framer-name="Info Section"],[data-framer-name="FAQ Section"]{display:none!important}</style>'
    style += '<template id="sb-legal-src">' + LEGAL_HTML + '</template>'
    h = re.sub(r'(<(?:div|section)[^>]*data-framer-name="Form Section")', lambda m: '<section id="sb-legal" class="sb-legal">' + LEGAL_HTML + '</section>' + m.group(1), h, count=1)
h = re.sub(r'<link rel="(?:icon|apple-touch-icon)"[^>]*framerusercontent[^>]*>', '', h)
style += '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'
if PAGE == '404': style += '<meta name="robots" content="noindex">'
style += '<meta http-equiv="Content-Security-Policy" content="img-src \'self\' data: blob:">'  # the template bundle still requests its own images for sections we hide; block them at the browser
style += '<script defer src="/_vercel/insights/script.js"></script>'
h = h.replace('</head>', style + '</head>', 1)
script = '<script id="soba-page">window.SB_PAGE=%s;window.SB_TITLE=%s;</script>' % (json.dumps(PAGE), json.dumps(TITLE)) + script
script += '<script id="soba-js">' + (ROOT/'soba.js').read_text() + '</script>'
h = h.replace('</body>', script + '</body>', 1)
# hero illustration -> our farmland image
PAT={'9c47fOR3CNoSsEtr6IEYJoKM':'pattern-grid.svg','8Li3bEi2pBFSRCKmHpW1kYBntrg':'pattern-dots.svg','wGAHOWhVswEtWkOKTJN6s2CW0':'pattern-dots.svg'}
for pid,pf in PAT.items(): h = re.sub(r'url\(https://framerusercontent\.com/images/'+pid+r'\.svg[^)]*\)', 'url(/img/'+pf+')', h)
HERO_SS='img/distribution-warehouse.webp 2400w'
CTA_SS=HERO_SS
SIZES='(max-width: 809.98px) 100vw, (max-width: 1199.98px) calc(100vw - 32px), min(100vw - 40px, 1440px)'
h = re.sub(r'srcset="https://framerusercontent\.com/images/epYjC31PopakdO7OcpxMsWS2y0\.png[^"]*"', 'srcset="%s"' % HERO_SS, h)
h = re.sub(r'src="https://framerusercontent\.com/images/epYjC31PopakdO7OcpxMsWS2y0\.png[^"]*"', 'src="img/distribution-warehouse.webp"', h)
h = re.sub(r'srcset="https://framerusercontent\.com/images/Pai7r7UdkYU5XAvtSCnRGv7lC8\.png[^"]*"', 'srcset="%s"' % CTA_SS, h)
h = re.sub(r'src="https://framerusercontent\.com/images/Pai7r7UdkYU5XAvtSCnRGv7lC8\.png[^"]*"', 'src="img/distribution-warehouse.webp"', h)
h = re.sub(r'srcset="https://framerusercontent\.com/images/D8cPRFjF76b1M4tP49rWtqxvWc\.png[^"]*"', 'srcset="%s"' % HERO_SS, h)
h = re.sub(r'src="https://framerusercontent\.com/images/D8cPRFjF76b1M4tP49rWtqxvWc\.png[^"]*"', 'src="img/distribution-warehouse.webp"', h)
print("image refs left:", h.count('epYjC31PopakdO7OcpxMsWS2y0'), h.count('Pai7r7UdkYU5XAvtSCnRGv7lC8'))
h = re.sub(r'<title>.*?</title>', '<title>%s</title>' % TITLE, h, count=1)

h = re.sub(r'mailto:\s*hello@nexura\.ai', 'mailto:trustin@usesoba.com', h); h = re.sub(r'href="https://contra\.com/[^"]*"', 'href="/"', h).replace('tel:+18001234567', 'tel:+14808198035').replace('tel: 8001234567', 'sms:+14808198035')
# head: Soba metadata instead of the template's
DESC = LEGAL_DESC or "Soba builds practical AI tools for distributors. Find sales opportunities, follow up with customers, and compare supplier quotes."
h = re.sub(r'<link rel="canonical" href="[^"]*">', '<link rel="canonical" href="%s"><link rel="icon" href="/favicon.svg" type="image/svg+xml">' % CANON, h)
h = re.sub(r'<meta property="og:url" content="[^"]*">', '<meta property="og:url" content="%s">' % CANON, h)
h = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % DESC, h)
h = re.sub(r'<meta name="framer-search-index(?:-fallback)?" content="[^"]*">', '', h)
h = re.sub(r'<meta property="og:title" content="[^"]*">', '<meta property="og:title" content="%s">' % OGTITLE, h)
h = re.sub(r'<meta name="twitter:title" content="[^"]*">', '<meta name="twitter:title" content="%s">' % OGTITLE, h)
h = re.sub(r'<meta property="og:description" content="[^"]*">', '<meta property="og:description" content="%s">' % DESC, h)
h = re.sub(r'<meta name="twitter:description" content="[^"]*">', '<meta name="twitter:description" content="%s">' % DESC, h)
h = re.sub(r'<meta property="og:image" content="[^"]*">', '<meta property="og:image" content="https://usesoba.com/img/og.jpg">', h)
h = re.sub(r'<meta name="twitter:image" content="[^"]*">', '<meta name="twitter:image" content="https://usesoba.com/img/og.jpg">', h)
print("template refs left in head:", h[:h.find('</head>')].count('nexura'))
# booking buttons carry the Soba link in the HTML itself, not only after soba.js runs
CAL = 'mailto:trustin@usesoba.com?subject=A%20workflow%20for%20our%20team'
def _bake_cal(m):
    tag, inner = m.group(1), m.group(2)
    text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', inner)).strip()
    if text in ('Talk to us', 'Talk to usTalk to us', 'Talk to us Talk to us', 'Pick a time'):
        tag = re.sub(r'href="[^"]*"', 'href="%s"' % CAL, tag) if 'href="' in tag else tag.replace('<a ', '<a href="%s" ' % CAL, 1)
    return tag + inner + '</a>'
h = re.sub(r'(<a\b[^>]*>)(.*?)</a>', _bake_cal, h, flags=re.S)
print("booking links baked:", h.count('href="%s"' % CAL))

# Keep the existing Framer layout, but bake the new content into the initial HTML
# as well as the runtime layer. This also removes unused legacy claims from HTML.
from html.parser import HTMLParser
class LayoutParser(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.nodes, self.stack = [], []
        self.lines = [0]
        for line in source.splitlines(keepends=True): self.lines.append(self.lines[-1] + len(line))
        self.feed(source)
    def source_offset(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col
    def handle_starttag(self, tag, attrs):
        node = dict(tag=tag, attrs=dict(attrs), start=self.source_offset(), inner=self.source_offset()+len(self.get_starttag_text()), parent=self.stack[-1] if self.stack else None)
        self.nodes.append(node)
        if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}: self.stack.append(node)
    def handle_startendtag(self, tag, attrs): pass
    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i]['tag'] == tag:
                node = self.stack[i]
                node.update(close=self.source_offset(), end=self.source_offset()+len(tag)+3)
                del self.stack[i:]
                break

layout = LayoutParser(h)
def within(node, name):
    p = node.get('parent')
    while p:
        if p['attrs'].get('data-framer-name') == name: return True
        p = p.get('parent')
    return False
remove_names = {'Demo Section', 'Logo Section', 'Solutions Section', 'Testimonial Section', 'Pricing Section'}
if PAGE == 'contact': remove_names |= {'Info Section', 'FAQ Section'}
edits = []
for node in layout.nodes:
    if 'end' not in node: continue
    name = node['attrs'].get('data-framer-name')
    if name in remove_names and not any(within(node,n) for n in remove_names):
        edits.append((node['start'], node['end'], ''))
    elif PAGE == 'home' and name == 'Container' and within(node, 'Feature Section'):
        edits.append((node['inner'], node['close'], (ROOT/'use-cases.html').read_text()))
    elif PAGE == 'home' and name == 'Canvas' and within(node, 'Integration Section'):
        edits.append((node['inner'], node['close'], (ROOT/'workflow.html').read_text()))
    elif PAGE == 'home' and node['tag'] == 'h1' and within(node, 'Hero'):
        edits.append((node['inner'], node['close'], '<span data-soba-heading>More time selling.</span> <span data-soba-heading>Less time on busywork.</span>'))
for start, end, replacement in sorted(edits, reverse=True): h = h[:start] + replacement + h[end:]
h = h.replace('alt="Tranquil Rural Scene"', 'alt="Boxed inventory in a distribution warehouse"')
(ROOT.parent/OUT).write_text(h, encoding="utf-8")
shutil.copyfile(ROOT.parent/OUT, DEPLOY); print("deployed to", DEPLOY.name)
print("bytes:", len(h))
