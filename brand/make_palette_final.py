import pathlib
root = pathlib.Path(__file__).parent
mark = (root/"mark.svg").read_text().replace('viewBox="0 0 64 64" width="64" height="64"', 'viewBox="0 0 64 64" class="mk"')
C = dict(blue="#0099FF", white="#FDFDFE", red="#F82705", ink="#0B1A2B")

def mock(theme):
    return f'''
<div class="mock {theme}">
  <div class="nav"><span class="brand">{mark}<span class="wm">soba</span></span><span class="links"><i>How it works</i><i>Pricing</i><b class="pill">Book a demo</b></span></div>
  <div class="hero">
    <span class="tag">After-hours sales desk</span>
    <h3>Every order answered. Even at 2 a.m.</h3>
    <p>Soba picks up the phone and the text line when your reps are off, takes the order in English or Spanish, and clears it against your price rules.</p>
    <div class="ctas"><b class="btn">Start free</b><b class="ghost">See a call</b></div>
  </div>
  <div class="cards">
    <div class="card"><small>Orders cleared tonight</small><strong>14</strong><em>3 waiting on a rep</em></div>
    <div class="card"><small>Avg. answer time</small><strong>4 s</strong><em>vs. next morning</em></div>
    <div class="card"><small>Countered</small><strong>2</strong><em>buyer called back</em></div>
    <div class="card red"><small>Rejected</small><strong>1</strong><em>below floor price</em></div>
  </div>
</div>'''

sw = "".join(f'<div class="sw" style="background:{v}"><span>{k}</span><code>{v}</code></div>' for k, v in C.items())
page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Soba palette</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="tokens.css">
<style>
*{{box-sizing:border-box}}body{{margin:0;background:#ECEEEA;color:var(--ink);font-family:var(--font-body)}}
.wrap{{max-width:1100px;margin:0 auto;padding:40px 20px 80px}}
h1{{font-family:var(--font-brand);font-size:28px;margin:0 0 6px}}.sub{{color:#667063;margin:0 0 24px}}
.strip{{display:grid;grid-template-columns:repeat(4,1fr);border-radius:14px;overflow:hidden;margin-bottom:26px;border:1px solid #DDE0DA}}
.sw{{height:120px;display:flex;flex-direction:column;justify-content:flex-end;padding:12px;font-size:12px;font-weight:600;color:#fff}}.sw code{{font-weight:500;opacity:.85}}
.sw:nth-child(2),.sw:nth-child(2) code{{color:var(--ink)}}
h2{{font-family:var(--font-brand);font-size:18px;margin:26px 0 10px}}
.mock{{border-radius:16px;padding:26px 30px;overflow:hidden}}
.mock.blue{{background:var(--blue);color:var(--white);--mu:var(--mute-on-blue);--line:rgba(255,255,255,.22);--sf:rgba(255,255,255,.12)}}
.mock.white{{background:var(--white);color:var(--blue);--mu:var(--mute-on-white);--line:rgba(0,0,0,.08);--sf:var(--blue-tint);border:1px solid #DDE0DA}}
.nav{{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;border-bottom:1px solid var(--line)}}
.brand{{display:flex;align-items:center;gap:8px}}.mk{{width:30px;height:30px}}.mk path{{stroke:currentColor}}
.wm{{font-family:var(--font-brand);font-weight:700;font-size:26px;letter-spacing:-.02em;color:currentColor;line-height:1}}
.links{{display:flex;align-items:center;gap:18px;font-size:13px;color:var(--mu)}}.links i{{font-style:normal}}
.pill{{font-weight:600;color:currentColor;border:1.5px solid currentColor;border-radius:999px;padding:6px 12px;font-size:13px}}
.hero{{padding:34px 0 26px;max-width:600px}}
.tag{{display:inline-block;background:var(--red);color:#fff;font-weight:600;font-size:12px;border-radius:999px;padding:4px 10px;margin-bottom:12px}}
h3{{font-family:var(--font-brand);font-weight:700;font-size:38px;line-height:1.08;margin:0 0 12px}}
.hero p{{margin:0 0 18px;color:var(--mu);font-size:15px;line-height:1.5}}
.white .hero p{{color:var(--ink)}}
.ctas{{display:flex;gap:10px}}.btn{{background:var(--red);color:#fff;font-weight:700;font-size:14px;border-radius:10px;padding:11px 18px}}.ghost{{font-weight:600;font-size:14px;border-radius:10px;padding:11px 18px;border:1.5px solid var(--line);color:inherit}}
.cards{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}}
.card{{background:var(--sf);border:1px solid var(--line);border-radius:12px;padding:14px}}.card small{{font-size:12px;color:var(--mu)}}.card strong{{display:block;font-family:var(--font-brand);font-size:30px;margin:4px 0 2px}}.card em{{font-style:normal;font-size:12px;color:var(--mu)}}
.card.red{{background:var(--red);border-color:var(--red);color:#fff}}.card.red small,.card.red em{{color:rgba(255,255,255,.8)}}
.lock{{display:flex;gap:12px;margin-top:10px}}.lock div{{flex:1;border-radius:14px;display:flex;align-items:center;gap:12px;padding:24px 26px}}
.lock .b{{background:var(--blue);color:var(--white)}}.lock .w{{background:var(--white);color:var(--blue);border:1px solid #DDE0DA}}.lock .r{{background:var(--red);color:#fff}}
.lock .mk{{width:40px;height:40px}}.lock .wm{{font-size:34px}}
@media(max-width:800px){{.strip{{grid-template-columns:repeat(2,1fr)}}.cards{{grid-template-columns:1fr 1fr}}.lock{{flex-direction:column}}}}
</style></head><body><div class="wrap">
<h1>Soba palette</h1><p class="sub">Blue ground, white type, red for accents and calls to action. Mark and wordmark in white on blue, blue on white.</p>
<div class="strip">{sw}</div>
<h2>Blue page</h2>{mock("blue")}
<h2>White section</h2>{mock("white")}
<h2>Lockups</h2>
<div class="lock">
  <div class="b">{mark}<span class="wm">soba</span></div>
  <div class="w">{mark}<span class="wm">soba</span></div>
  <div class="r">{mark}<span class="wm">soba</span></div>
</div>
</div></body></html>'''
(root/"palette.html").write_text(page)
print("wrote palette.html")
