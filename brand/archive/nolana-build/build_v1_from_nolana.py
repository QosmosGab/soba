import re, html, urllib.parse, pathlib
h = pathlib.Path("live.html").read_text(encoding="utf-8")
h = re.sub(r'<script\b[^>]*>.*?</script>', '', h, flags=re.S)

# ---- fonts: alias Nolana's families onto Quicksand / Inter
n_ff = len(re.findall(r'@font-face\s*\{[^}]*?(?:Aspekta|DM Sans|Figtree)[^}]*\}', h))
h = re.sub(r'@font-face\s*\{[^}]*?(?:Aspekta|DM Sans|Figtree)[^}]*\}', '', h)
QS = "https://fonts.gstatic.com/s/quicksand/v37/6xKtdSZaM9iE8KbpRA_hK1QNYuDyPw.woff2"
IN = "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2"
wmap = {300:500,350:500,400:500,450:500,500:600,550:600,600:700,650:700,700:700,900:700}
faces = ""
for w, q in wmap.items():
    for fam in (f"Aspekta {w}", f"Aspekta {w} Placeholder"):
        faces += f'@font-face{{font-family:"{fam}";font-weight:{q};font-style:normal;src:url({QS}) format("woff2")}}\n'
for fam in ("DM Sans", "DM Sans Placeholder", "Figtree", "Figtree Placeholder"):
    faces += f'@font-face{{font-family:"{fam}";font-weight:100 900;font-style:normal;src:url({IN}) format("woff2")}}\n'
inject = f'''<style id="soba-fonts">{faces}</style>
<style id="soba-freeze">
[data-framer-appear-id]{{opacity:1!important;transform:none!important}}
span[style*="opacity:0.001"]{{opacity:1!important;transform:none!important}}
[style*="will-change:transform"]{{opacity:1!important}}
[style*="perspective(1200px)"]{{transform:none!important}}
.framer-text[style*="opacity:0;"]{{opacity:1!important}}
div[style*="position:sticky"][style*="opacity:0"]{{opacity:1!important}}
[style*="opacity:0.001"]{{opacity:1!important;transform:none!important}}
[data-framer-name="inner content"] [style*="opacity:0"]:not([style*="pointer-events:none"]){{opacity:1!important;visibility:visible!important;filter:none!important}}
[style*="translateY(6px)"],[style*="translateY(16px)"],[style*="translateY(20px)"]{{transform:none!important}}
[style*="color:rgba(212, 212, 220, 1)"]{{color:rgb(18,18,24)!important}}
/* platform wheel: Framer's script orbits these four cards; park them at four corners instead */
[style*="width:288px;height:93.6px"]:nth-child(1){{transform:translate(0,140px)!important}}
[style*="width:288px;height:93.6px"]:nth-child(2){{transform:translate(0,340px)!important}}
[style*="width:288px;height:93.6px"]:nth-child(3){{transform:translate(508px,140px)!important}}
[style*="width:288px;height:93.6px"]:nth-child(4){{transform:translate(508px,340px)!important}}
</style>'''
orbit = "".join(f'[style*="scale(0.4691)"]:nth-child({i}){{transform:translate(calc(-50% + {int((i-12.5)*120)}px),-50%) scale(0.4691)!important;opacity:1!important}}\n' for i in range(1,25))
i = inject.rfind('</style>'); inject = inject[:i] + '/* integration logos: Framer scrolls these; lay them out in a row */\n' + orbit + inject[i:]
h = h.replace('</head>', inject + '</head>', 1)
# videos: play without the Framer runtime
h, kv = re.subn(r'<video\b(?![^>]*\bautoplay\b)', '<video autoplay muted loop playsinline', h)
print("videos set to autoplay:", kv)
print("font-faces removed:", n_ff)

# ---- logos
CL = ''.join(f'<path d="M0 0 Q-15 -11 0 -27 Q15 -11 0 0 Z" fill="none" stroke="{{c}}" stroke-width="4" stroke-linejoin="round" transform="rotate({r})"/>' for r in (0,120,240))
def clover_g(c, tx, ty, s): return f'<g transform="translate({tx} {ty}) scale({s})">' + CL.replace('{c}', c) + '</g>'
def wordmark(color, w, hgt):
    fs = hgt * 0.95
    s = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {hgt}">' + clover_g(color, hgt*0.5, hgt*0.56, hgt/64*0.95) +
         f'<text x="{hgt*1.05:.1f}" y="{hgt*0.82:.1f}" font-family="Quicksand, sans-serif" font-weight="700" font-size="{fs:.1f}" fill="{color}">soba</text></svg>')
    return "data:image/svg+xml," + urllib.parse.quote(s, safe="")
h, k1 = re.subn(r'https://framerusercontent\.com/images/4aYsp9FvWyrd0BdP1rul7yMw\.svg\?width=86&amp;height=20', wordmark("#fff", 86, 20), h)
print("nav wordmarks replaced:", k1)

# ---- testimonial (per-character spans): replace whole h2 body
QUOTE = "“Half our buyers text in Spanish at ten at night. Soba answers them in Spanish, gets the cases and the pickup day, and only pings me if the price is off.”"
def fix_quote(m):
    inner = m.group(2)
    st = re.search(r'<span style="white-space:nowrap"><span style="([^"]*)">“</span>', inner)
    style = st.group(1) if st else ""
    return m.group(1) + f'<span style="{style}">{html.escape(QUOTE, quote=False)}</span></h2>'
h, kq = re.subn(r'(<h2 class="framer-text framer-styles-preset-boceyn"[^>]*>)(<span style="white-space:nowrap"><span style="[^"]*">“</span>.*?)</h2>', fix_quote, h, flags=re.S)
print("quotes replaced:", kq)

# ---- section cuts (2 Nov): remove whole elements by their Framer class
VOID = {"img","br","hr","input","source","meta","link","track","wbr","col","area","base","embed","param"}
TAG = re.compile(r'<(/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|\'[^\']*\'|[^\s>]+))?)*)\s*(/?)>|<!--.*?-->', re.S)
def remove_by_class(doc, cls):
    n = 0
    pat = re.compile(r'<([a-zA-Z0-9]+)\b(?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|\'[^\']*\'|[^\s>]+))?)*?\s+class="[^"]*\b' + re.escape(cls) + r'\b[^"]*"')
    while True:
        m = pat.search(doc)
        if not m: break
        i = m.start(); depth = 0; pos = i
        while True:
            t = TAG.search(doc, pos)
            if not t: pos = len(doc); break
            pos = t.end()
            if t.group(0).startswith('<!--'): continue
            closing, name, selfclose = t.group(1), t.group(2).lower(), t.group(4)
            if closing: depth -= 1
            elif selfclose or name in VOID: pass
            else: depth += 1
            if depth == 0: break
        doc = doc[:i] + doc[pos:]; n += 1
    print(f"removed {cls}: {n}")
    return doc
for cls in ["framer-k6l2pu-container","framer-f7jbff","framer-txed7k","framer-m9kp39-container","framer-ivmacd","framer-mlomxy-container","framer-19xoabh","framer-bkr88u","framer-1d58e5b","framer-1dzco0y","framer-1thvq8z","framer-kb63x6","framer-74yqok","framer-11vdx5b","framer-14g749m"]:
    h = remove_by_class(h, cls)

def remove_enclosing(doc, text, marker):
    n = 0
    while True:
        i = doc.find(text)
        if i < 0: break
        j = doc.rfind(marker, 0, i)
        k = doc.rfind('<', 0, j)
        if j < 0 or k < 0: break
        # remove the element starting at k
        depth = 0; pos = k
        while True:
            t = TAG.search(doc, pos)
            if not t: pos = len(doc); break
            pos = t.end()
            if t.group(0).startswith('<!--'): continue
            closing, name, selfclose = t.group(1), t.group(2).lower(), t.group(4)
            if closing: depth -= 1
            elif selfclose or name in VOID: pass
            else: depth += 1
            if depth == 0: break
        doc = doc[:k] + doc[pos:]; n += 1
    print(f"removed rows containing {text!r}: {n}")
    return doc
for t in ["Service Status", "Trust Center"]:
    h = remove_enclosing(h, t, 'data-framer-name="link-item"')

MAP = [
 ("Latest", "Soba"), ("Lloyd's Lab Cohort 16", "After-hours sales desk for produce"), ("Book a Demo", "Book a demo"),
 ("claim", "buyer"),
 ("lives in four systems.", "calls after close."), ("Leakage lives between them.", "Nobody writes the order."),
 ("lives in four", "calls after"), ("systems. Leakage lives between them.", "close. Nobody writes the order."),
 ("Nolana’s agentic AI connects every claim across every system and every party, so claims move faster and reserves are freed earlier.",
  "Soba answers your sales line after hours, takes the order in English or Spanish, and confirms it at the prices you set, so no load waits until morning."),
 ("Explore Platform", "How it works"),
 ("Claims costs are rising, while claims operations remain heavily manual. Handlers are bogged down processing documents, rekeying data, and chasing updates. Nolana’s AI agents change that.",
  "Produce doesn't stop at 5. Buyers call and text after close, and the order waits on a voicemail, a callback, and a rep's morning. Soba answers, takes the order at your prices, and has it written up before anyone's in."),
 ("Core Products", "What Soba Does"),
 ("Nolana's AI agents automate insurance claims workflows", "Soba takes the order after hours"),
 ("from first notice of loss to settlement while keeping handlers in control.", "from the first ring to the written confirmation, with your reps in control."),
 ("AI FNOL intake and triage", "Answers calls and texts"),
 ("Captures claims, requests missing information, assesses coverage, and routes to the right team.", "Picks up your company line after close or after four rings, in English or Spanish. Asks only for what's missing and reads every number back."),
 ("Claims document processing", "Confirms at your prices"),
 ("Processes documents and communications to reduce manual data entry and keep claims moving.", "Checks each request against tonight's price sheet and volume limits. Inside the rules, the order is confirmed on the call with a reference number."),
 ("Claims lifecycle management", "Hands the rest to a rep"),
 ("Monitors claim progress, identifies dormant claims, automates follow-ups, and recommends actions.", "Anything outside the rules goes to your on-call reps on WhatsApp: Approve, Counter, Reject or Take over. Soba calls the buyer back with the answer."),
 ("faster cycle times, lower loss ratio.", "more orders written, fewer loads missed."),
 ("Faster Cycle Times", "Faster Answer"), ("up to 50x", "under 4 rings"),
 ("Higher Handler Throughput", "More Orders Written"),
 ("Lower Loss Ratio", "Missed After-Hours Loads"), ("up to 5%", "down to 0"),
 ("Nolana is part of", "Soba is part of"),
 ("Group Head of Digital R&D", "Sales Manager"), ("Zurich Insurance", "Importer, McAllen TX"),
 ("Supported Lines", "Who it's for"),
 ("Nolana helps insurers handle complex claims across multiple lines", "Built for the desks that sell produce by the load"),
 ("— from property and casualty to specialty.", "— grower-shippers, importers and wholesalers."),
 ("Property", "Grower-shippers"), ("Commercial and residential property claims, including fire, water, weather, and catastrophes.", "Nogales, Salinas and the Valley. Tomatoes, cucumbers, peppers, squash. Buyers who call at night for tomorrow's trucks."),
 ("Specialty", "Importers"), ("Manages complex specialty claims such as marine, aviation, energy, and construction.", "McAllen, Pharr and Miami. Avocados, limes, mangos, berries. Orders that land while the Mexican side is still working."),
 ("Liability", "Wholesalers"), ("Supports general, professional, employer, and product liability claims involving multiple parties.", "Terminal markets and distributors. Mixed loads for retailers, foodservice and jobbers, ordered after the day crew is gone."),
 ("Every claim starts with a first notice of loss - Nolana makes intake effortless and keeps policyholders informed.", "Every order starts with a ring. Here's what happens next."),
 ("Adaptive AI FNOL intake that adapts to policyholder input", "Buyer calls or texts after close. Soba answers in their language."),
 ("Automates coverage evaluation", "Soba takes product, size, pack, cases, price and pickup, and reads it back."),
 ("Routes the claim to the right team and recommends next actions", "Inside your price rules it's confirmed. Outside, your rep gets a one-tap card."),
 ("Automatically updates existing systems", "Buyer gets a written confirmation. You get the order card and a morning summary."),
 ("Email", "SMS"), ("Web Form", "WhatsApp"), ("Live Chat", "Email"), ("Call center", "Call forward"), ("Call Center", "Call forward"), ("Ai voice", "AI voice"),
 ("Automatically request missing information", "Asks only for what's missing: size, pack, cases, pickup"),
 ("Document validation", "Price rule check"), ("Auto context check for relevancy and timelines", "Compares against tonight's sheet and volume limits"),
 ("Triage", "Rep card"), ("Auto transfer to the right claim handler", "Approve, Counter, Reject or Take over on WhatsApp"),
 ("Update third party systems", "Confirmation"), ("Update third-party systems", "Confirmation"), ("Seamless API synchronization", "Written confirmation and order card"),
 ("Nolana automates claims lifecycle workflows so Lloyd's and London market insurers can move claims faster and be on top of their portfolios.",
  "Soba runs the after-hours desk so grower-shippers and importers can write every order and stay on top of their price sheet."),
 ("Delegated Authority Triage.", "Price Rule Clearing."),
 ("Extract claim details from emails, check them against delegated authority thresholds, then auto approve, reject, or escalate.",
  "Take the order by voice or text, check it against your price rules and volumes, then auto-confirm, counter, or send to a rep."),
 ("Delegated authority claims", "After-hours requests"), ("1,284 · claims in", "1,284 · requests in"),
 ("Over limit", "Below rule"), ("Created & updated in the existing claims system.", "Sent to the on-call reps as a WhatsApp card."),
 ("Under limit", "At or above rule"), ("Nolana auto-emails the coverholder: within authority thresholds, no insurer submission needed.", "Soba confirms on the call: inside the price rules, no rep needed."),
 ("Nolana checks each against", "Soba checks each against"), ("authority limits", "your price rules"),
 ("Keep claims moving with minimal human intervention.", "Keep orders moving with minimal rep interruption."),
 ("Nolana identifies static claims, uncovers the reason they’ve stalled, and automatically routes them to the right handler with the next recommended action — reducing cycle times and freeing reserves.",
  "Soba spots requests waiting on a rep, chases the answer, calls the buyer back, and drops the order card in the morning summary — so nothing sits until opening."),
 ("Integrates with claims workbenches, policy platforms, and internal systems, so AI support appears inside the workflow instead of adding another platform to manage.",
  "Works with your phone line, WhatsApp, email and price sheet, so the desk runs where your reps already are instead of adding another platform to manage."),
 ("Cross-Channel Communication", "Voice and Text"), ("Cross-Channel", "Voice and"), ("Communication", "Text"),
 ("Task Execution", "Order Taking"),
 ("Analysis & Decisioning", "Price Rules"), ("Analysis &", "Price"), ("Decisioning", "Rules"),
 ("Custom Agent Builder", "Rep Approvals"), ("Custom Agent", "Rep"), ("Builder", "Approvals"),
 ("Our Agentic AI Platform", "Our After-Hours Desk"),
 ("Enterprise Security", "Your rules"), ("Featured Workflow", "How it works"), ("Deploys in weeks not months.", "Live in one afternoon."),
 ("Built for enterprise environments with security, compliance, and flexible deployment from day one.", "Your prices, your reps, your line. Soba never freelances."),
 ("SSO support", "Your price sheet"), ("Secure access with enterprise SSO integration across your organization.", "Send tonight's prices by text or email. Soba never volunteers a price you didn't set."),
 ("Flexible deployment", "Your reps decide"), ("Deploy Nolana across your carrier or brokerage environment with flexible infrastructure options.", "Anything outside the rules goes to your on-call reps on WhatsApp. First to answer decides."),
 ("Enterprise security & SOC 2", "Every call on record"), ("Enterprise-grade security with SOC 2 compliance, audit trails, and access controls.", "Every call recorded and transcribed, every order confirmed in writing, every morning summarized."),
 ("Solutions", "How it works"), ("Platform", "Who it's for"), ("Case Studies", "About"), ("Insights", "Contact"), ("Explore", "Company"),
 ("Enterprise AI Platform", "After-hours sales desk"),
 ("AI agents that work inside the systems you already have — so claims move faster, and handlers stay in control.", "Forward your line after close. Wake up to the orders."),
 ("AI for Lloyd’s & London Market Insurers", "How it works"), ("AI for Lloyd’s & London Market Brokers", "Who it's for"),
 ("AI for Lloyd’s & London", "Soba for"), ("Market Insurers", "Grower-shippers"), ("Market Brokers", "Importers"), ("AI for Insurers & MGAs", "Book a demo"),
 ("Privacy Statement", "Privacy"), ("Cookie Policy", "Terms"), ("Terms & Conditions", "SMS and WhatsApp policy"),
 ("Lloyd's Lab, One Lime Street, London EC3M 7HA", "hello@usesoba.com"),
 ("Copyright © 2026, Nolana. All rights reserved", "© 2026 Project Peach Inc."),
]
def norm(s):
    s = html.unescape(s); s = re.sub(r'\s+', ' ', s).strip(); s = re.sub(r' ([,.!?;:])', r'\1', s); return s
parts = re.split(r'(<[^>]+>)', h)
in_style = False; text_idx = []
for i in range(len(parts)):
    if i % 2 == 1:
        t = parts[i].lower()
        if t.startswith('<style'): in_style = True
        elif t.startswith('</style'): in_style = False
    elif parts[i].strip() and not in_style: text_idx.append(i)
counts = {}
for old, new in MAP:
    o = norm(old); maxlen = len(o.split(' ')) + 2
    text_idx = [i for i in text_idx if parts[i].strip()]
    j = 0
    while j < len(text_idx):
        for L in range(1, min(maxlen, len(text_idx) - j) + 1):
            seg = [parts[text_idx[j+k]] for k in range(L)]
            joined = norm(' '.join(seg))
            if joined == o:
                words = new.split(' '); out = []
                origc = [len(norm(s).split(' ')) for s in seg]; pos = 0
                for k in range(L):
                    take = origc[k] if k < L-1 else len(words) - pos
                    chunk = words[pos:pos+take]; pos += take
                    lead = re.match(r'\s*', seg[k]).group(0); trail = re.search(r'\s*$', seg[k]).group(0)
                    txt = ' '.join(chunk)
                    if chunk and k > 0 and not lead and not seg[k].strip()[:1].isalnum() and txt[:1].isalnum() and not out[-1].endswith(' '): txt = ' ' + txt
                    out.append(lead + html.escape(txt, quote=False) + trail if chunk else lead + trail)
                for k in range(L): parts[text_idx[j+k]] = out[k]
                counts[old] = counts.get(old, 0) + 1
                j += L - 1; break
            if len(joined) > len(o): break
        j += 1
h = ''.join(parts)
missing = [o for o, _ in MAP if o not in counts]
print("replaced:", sum(counts.values()), "runs; missing:", missing)

# footer column 1 title: first "How it works" after each footer top block becomes "Product"
pos = 0; kf = 0
while True:
    i = h.find('class="framer-1bciptl', pos)
    if i < 0: break
    j = h.find('>How it works<', i)
    if j > 0 and j - i < 20000:
        h = h[:j] + '>Product<' + h[j+14:]; kf += 1
    pos = i + 10
print("footer titles retitled:", kf)
h = re.sub(r'<title>.*?</title>', '<title>AI sales desk for produce | Soba</title>', h, count=1)
h = re.sub(r'(<meta name="description" content=")[^"]*', r'\1Soba answers your produce sales line after hours, takes the order in English or Spanish, and confirms it at the prices you set.', h)
pathlib.Path("clone.html").write_text(h, encoding="utf-8")
print("bytes:", len(h))
