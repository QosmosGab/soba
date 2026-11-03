"""Soba overlay on the nexura.framer.ai mirror: logo + copy, applied in the HTML (first paint)
and again at runtime after Framer hydrates (Framer repaints its own text otherwise)."""
import re, html, json, urllib.parse, pathlib
import os
ROOT = pathlib.Path(__file__).parent
import sys, subprocess, shutil
PAGES = ['home', 'contact', 'privacy', 'terms', 'messaging']
PAGE = sys.argv[1] if len(sys.argv) > 1 else 'home'
if PAGE == 'all':
    for pg in PAGES: subprocess.run([sys.executable, __file__, pg], check=True)
    sys.exit(0)
LEGAL = PAGE in ('privacy', 'terms', 'messaging')
SRC = 'mirror.html' if PAGE == 'home' else 'mirror-contact.html'
OUT = {'home': 'v1.html', 'contact': 'contact.html'}.get(PAGE, PAGE + '.html')
SITE = ROOT.parent.parent  # docs/
DEPLOY = SITE/('index.html' if PAGE == 'home' else OUT)
h = (ROOT/SRC).read_text(encoding="utf-8")
LEGAL_HTML = LEGAL_H1 = LEGAL_DATE = LEGAL_DESC = None
if LEGAL:
    lsrc = (SITE/'src'/(PAGE + '.html')).read_text(encoding='utf-8')
    LEGAL_DESC = re.search(r'<meta name="description" content="([^"]*)"', lsrc).group(1)
    LEGAL_H1 = re.search(r'<h1>(.*?)</h1>', lsrc, re.S).group(1).strip()
    LEGAL_DATE = re.search(r'<p class="muted">(.*?)</p>', lsrc, re.S).group(1).strip()
    body = lsrc[lsrc.find('</p>', lsrc.find('<p class="muted">')) + 4:]
    body = body[:body.rfind('</main>')] if '</main>' in body else body
    LEGAL_HTML = body.strip()
TITLE = {'home': 'Soba - Revenue solutions for produce companies', 'contact': 'Contact - Soba'}.get(PAGE, (LEGAL_H1 or '') + ' - Soba')
OGTITLE = {'home': 'Soba. Your sales desk now answers 24/7', 'contact': 'Contact Soba'}.get(PAGE, TITLE)
CANON = 'https://usesoba.com/' + ('' if PAGE == 'home' else PAGE)

CONTACT_MAP = [
 ("Start the conversation. We're ready to help.", "Tell us about your desk."),
 ("Let's talk about what intelligent automation can do for your business. Tell us where you're at and we'll figure out the rest.",
  "What you sell, where your buyers are, and how orders reach you after close. We reply within one business day."),
 ("What best describes you?", "What kind of operation?"),
 ("Marketing Agency", "Grower-shipper"), ("In-house Marketing Team", "Importer"), ("AI Consultant", "Wholesaler"), ("Startup Founder", "Distributor"),
 ("Where are you in your journey?", "How do after-hours orders reach you today?"),
 ("Just researching", "Voicemail and callbacks"), ("Evaluating tools / comparing options", "A rep's cell phone"), ("Already have a solution, looking to switch", "Text or WhatsApp"),
 ("Anything else you'd like us to know?", "Message"),
 ("Send message", "Send"),
 ("Got a question? We'll get back to you within 24 hours.", "Got a question? We reply within one business day."),
 ("hello@nexura.ai", "Send an email"),
 ("Join the community", "Book a demo"),
 ("Stay up to date with product news, tips, and updates.", "Thirty minutes on a call, with your line and your price sheet."),
 ("Follow us on X", "Pick a time"),
 ("Talk to sales", "Text or call"),
 ("Prefer to talk it out? Our team is available Mon\u2013Fri, 9am\u20136pm.", "Prefer to talk it out? Text or call and a founder picks up."),
 ("+1 (800) 123-4567", "Text us"),
 ("Can I switch plans or cancel anytime?", "Does Soba speak Spanish?"),
 ("Absolutely. All plans are flexible with no long-term contracts. You can upgrade, downgrade, or cancel at any time.",
  "Yes. It answers in whichever language the buyer uses, English or Spanish, and reads every number back before it confirms."),
 ("Do you offer custom or enterprise pricing?", "What happens when a buyer asks for a price below my sheet?"),
 ("Yes. If your team has specific needs, reach out via the form or book a call with sales and we'll put together a custom plan.",
  "Nothing gets confirmed. The request goes to your on-call rep on WhatsApp to approve, counter, reject or take over."),
 ("How quickly will I hear back after submitting the form?", "How quickly do you answer clients?"),
 ("We typically respond within 1 business day. For urgent inquiries, feel free to email us directly.",
  "Instantly. Soba answers the phone and replies to texts 24 hours a day, 7 days a week."),
 ("What kind of support is included with my plan?", "What do I need to set up?"),
 ("All plans include access to our help center and email support. Pro and Enterprise plans get priority support and a dedicated account manager.",
  "Forward your line after close or after four rings, and text or email tonight's price sheet. That's it."),
 ("Can I integrate Nexura with my marketing tools?", "Can I keep my phone number?"),
 ("Yes \u2014 Nexura connects with a wide range of tools including CRMs, email platforms, and analytics software. Check our integrations page for the full list.",
  "Yes. Soba sits behind your existing line through call forwarding. Nothing changes for your buyers."),
]

MAP = [
 # nav
 ("Product", "How it works"), ("Pricing", "Set up"), ("Integration", "Solution"), ("Resources", "Company"), ("Get started", "Book a demo"),
 # hero
 ("New Release Available", "After-hours sales desk for produce"),
 ("Scale faster with your AI Agent", "Your sales desk now answers 24/7"),
 ("Spend less time on logistics and more on strategy while Nexura handles the execution of your global marketing operations.",
  "Soba picks up your company line after close, takes the buyer's order in English or Spanish, and confirms it at the prices you set."),
 ("Start for free", "Book a demo"), ("Talk to sales", "Contact us"),
 ("Aaron", "Ruben"), ("Sarah", "Marisol"),
 # intelligence section
 ("Marketing at full intelligence. Stop guessing, start growing — Nexura analyzes your data and delivers insights that actually move the needle.",
  "Stop losing sales to missed calls."),
 ("Conversational AI Agent", "Voice and text desk"),
 ("Ask Nexura anything about your performance. Get data-backed recommendations instantly.", "Answers calls and texts after close, in English or Spanish. Reads every number back."),
 ("Campaign Tracking", "Price rule clearing"),
 ("Monitor ROI, conversions, and spend across every channel in real time. Spot what's working and cut what isn't.", "Checks each request against tonight's sheet and volume limits. Inside the rules, it's confirmed on the call."),
 ("Unified Dashboard", "Rep card on WhatsApp"),
 ("See your entire marketing operation from one central view. KPIs, trends, and activity feeds all live in one place.", "Anything outside the rules goes to your on-call reps: Approve, Counter, Reject or Take over."),
 ("Automated Workflow", "Morning summary"),
 ("Design and deploy multi-step agent journeys. Configure how Nexura thinks, acts, and reports — entirely on your terms.", "Fifteen minutes before opening: what was won, what's waiting, every transcript, and the order card."),
 # integrations
 ("Connects with your existing stack.", "Set it up in 5 minutes."),
 ("Nexura plugs into the tools your team already uses — no migration required.", "Plugs into your phone line. Controlled through WhatsApp."),
 ("Explore 50+ supported integrations", "Forward your line after close or after four rings"),
 ("Securely link your account", "Text or email tonight's price sheet"),
 ("Sync and streamline your workflow", "Reps approve exceptions on WhatsApp"),
 ("Explore all integrations", "See how it works"),
 # teams
 ("Built for every marketing team.", "More sales. Less chasing."),
 ("Whether you're a solo marketer or a full-service agency, Nexura adapts to the way you work.", "Every buyer answered. Every order written up. Every night."),
 ("For marketing team", "For grower-shippers"), ("For startup", "For importers"), ("For agency", "For wholesalers"),
 ("Stop manually pulling reports across platforms.", "Stop finding out about Thursday's loads on Friday."),
 ("Nexura connects to your ad channels and surfaces exactly where your budget is working hardest.", "Soba takes the night orders from Nogales, Salinas and the Valley and has the cards ready before the desk opens."),
 ("Meta Ads", "Roma 5x6"), ("3 campaigns currently active", "320 cases, Fresh Valley, Thu pickup"),
 ("Google Ads", "Super cucumbers"), ("142 clicks tracked today", "200 cases confirmed at sheet"),
 ("ROI Score", "Price rules"), ("4.2x return this week", "9 of 10 cleared without a rep"),
 ("Budget Alert", "Below rule"), ("15% remaining on Q1 spend", "1 request waiting on a rep"),
 ("Top Channel", "Top buyer"), ("Paid search leading conversions", "Fresh Valley, 4 orders this week"),
 ("Do more with a lean marketing team.", "Do more with a lean sales desk."),
 ("Set your workflows once and let Nexura run your campaigns continuously in the background.", "Set your price rules once and let Soba take the orders every night."),
 ("Data Intake", "Buyer call"), ("Input", "Order"), ("Report", "Confirmation"), ("Output", "Order card"),
 ("Manage every client from one intelligent platform.", "Manage every buyer from one desk."),
 ("Deliver AI-powered recommendations and scheduled reports without the manual overhead.", "Written confirmations and a morning summary, without the manual overhead."),
 ("Ads Channels", "Night orders"), ("Conversion Trend", "Orders after close"),
 # testimonials
 ("Loved by teams worldwide.", "What the desks are saying."),
 ("From lean startups to global agencies, here's what our users have to say.", "Grower-shippers, importers and wholesalers running Soba on their line."),
 ("\"Nexura cut our reporting time in half. We now spend that time actually optimizing campaigns instead.\"", "\"We used to find out about the Thursday loads on Friday morning. Now the order card is sitting there when I walk in.\""),
 ("Sarah Chen, Head of Growth at Codecraft", "Ruben P., Senior sales rep, Nogales AZ"),
 ("\"Nexura flagged three underperforming campaigns in seconds. That insight alone made it a no-brainer.\"", "\"Half our buyers text in Spanish at ten at night. Soba answers them in Spanish and only pings me if the price is off.\""),
 ("Emma Hartley, Marketing Lead at Acme", "Marisol G., Sales manager, McAllen TX"),
 ("\"Switching to Nexura was the easiest decision we made this quarter. Our ROAS improved by 30% in the first month alone.\"", "\"I was worried it would promise prices. It never has. It either hits our sheet or it sends me the card.\""),
 ("Claire Donovan, Marketing Lead at LaunchSimple", "Dave K., Owner, wholesaler, Salinas CA"),
 ("\"We manage 12 client accounts and Nexura keeps everything in one place. It's like an extra team member.\"", "\"A buyer called at 1 a.m. for 200 cases of super cucumbers. Soba took it, read it back, and the card was in my email at 6:45.\""),
 ("James Walker, Founder at PictelAI", "Luis A., Importer, Pharr TX"),
 # pricing
 ("Start free and scale as your team grows. No hidden fees, no surprises.", "One desk, one price per line. No setup fee, no contract."),
 ("Starter", "Pilot"), ("Forever", "First 30 nights"), ("For solo marketers getting started", "For one desk trying it on real orders"),
 ("1 active campaign", "1 company line"), ("Basic performance dashboard", "English and Spanish"), ("50 AI tokens per month", "Up to 100 orders"), ("Weekly automated reports", "Morning summary"),
 ("Pro", "Desk"), ("49", "499"), ("36", "399"), ("Continue with Pro", "Start with Desk"), ("For growing teams", "For a desk with one line and on-call reps"),
 ("Unlimited active campaigns", "Unlimited orders"), ("Full analytics dashboard", "Price rules and volume limits"), ("150 AI tokens per month", "Rep cards on WhatsApp"), ("Custom workflow builder", "Call recordings and transcripts"),
 ("Agency", "Multi-desk"), ("149", "1,499"), ("109", "1,199"), ("Continue with Agency", "Talk to us"), ("For agencies managing clients", "For companies with several desks or lines"),
 ("Everything in Pro", "Everything in Desk"), ("Up to 15 client accounts", "Up to 5 lines"), ("Multi-account dashboard", "Shared price sheet across desks"), ("White-label report exports", "Order card export to your system"),
 # cta + footer
 ("Your best-performing campaign starts here.", "Book a demo, or just ask a question."),
 ("Set up in minutes. See results from day one.", "Thirty minutes on a call, or an email to hello@usesoba.com. Either way, a straight answer."),
 ("The AI agent built for modern marketing teams.", "Revenue solutions for the produce supply chain"),
 ("Platform", "Soba"), ("Demo", "Book a demo"), ("Blog", "How it works"), ("Solutions", "Solution"),
 ("Terms of Services", "Terms"), ("Privacy Policy", "Privacy"),
 ("Designed by Lunis. All rights reserved.", "© 2026 Soba AI. All rights reserved."),
 ("Nexura", "soba"),
]
if PAGE == 'contact': MAP = CONTACT_MAP + MAP
if LEGAL: MAP = [("Contact", "Legal"), ("Start the conversation. We're ready to help.", LEGAL_H1), ("Let's talk about what intelligent automation can do for your business. Tell us where you're at and we'll figure out the rest.", LEGAL_DATE)] + CONTACT_MAP + MAP
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
if LEGAL:
    style += '<style id="soba-legal-hide">[data-framer-name="Form Section"],[data-framer-name="Info Section"],[data-framer-name="FAQ Section"]{display:none!important}</style>'
    style += '<template id="sb-legal-src">' + LEGAL_HTML + '</template>'
    h = re.sub(r'(<(?:div|section)[^>]*data-framer-name="Form Section")', lambda m: '<section id="sb-legal" class="sb-legal">' + LEGAL_HTML + '</section>' + m.group(1), h, count=1)
style += '<script defer src="/_vercel/insights/script.js"></script>'
h = h.replace('</head>', style + '</head>', 1)
script = '<script id="soba-page">window.SB_PAGE=%s;window.SB_TITLE=%s;</script>' % (json.dumps(PAGE), json.dumps(TITLE)) + script
script += '<script id="soba-js">' + (ROOT/'soba.js').read_text() + '</script>'
h = h.replace('</body>', script + '</body>', 1)
# hero illustration -> our farmland image
h = re.sub(r'srcset="https://framerusercontent\.com/images/epYjC31PopakdO7OcpxMsWS2y0\.png[^"]*"', 'srcset="img/hero.webp 2400w"', h)
h = re.sub(r'src="https://framerusercontent\.com/images/epYjC31PopakdO7OcpxMsWS2y0\.png[^"]*"', 'src="img/hero.webp"', h)
h = re.sub(r'srcset="https://framerusercontent\.com/images/Pai7r7UdkYU5XAvtSCnRGv7lC8\.png[^"]*"', 'srcset="img/cta.jpg?v=3 2400w"', h)
h = re.sub(r'src="https://framerusercontent\.com/images/Pai7r7UdkYU5XAvtSCnRGv7lC8\.png[^"]*"', 'src="img/cta.jpg?v=3"', h)
h = re.sub(r'srcset="https://framerusercontent\.com/images/D8cPRFjF76b1M4tP49rWtqxvWc\.png[^"]*"', 'srcset="img/hero.webp 2400w"', h)
h = re.sub(r'src="https://framerusercontent\.com/images/D8cPRFjF76b1M4tP49rWtqxvWc\.png[^"]*"', 'src="img/hero.webp"', h)
print("image refs left:", h.count('epYjC31PopakdO7OcpxMsWS2y0'), h.count('Pai7r7UdkYU5XAvtSCnRGv7lC8'))
h = re.sub(r'<title>.*?</title>', '<title>%s</title>' % TITLE, h, count=1)

h = re.sub(r'mailto:\s*hello@nexura\.ai', 'mailto:hello@usesoba.com', h); h = re.sub(r'href="https://contra\.com/[^"]*"', 'href="/"', h).replace('tel:+18001234567', 'tel:+14808198035')
# head: Soba metadata instead of the template's
DESC = LEGAL_DESC or "Soba picks up your company line after close, takes the buyer's order in English or Spanish, and confirms it at the prices you set."
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
(ROOT.parent/OUT).write_text(h, encoding="utf-8")
shutil.copyfile(ROOT.parent/OUT, DEPLOY); print("deployed to", DEPLOY.name)
print("bytes:", len(h))
