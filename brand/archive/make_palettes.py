"""Palette sheet: blue-led palettes with one eye-catching accent, each shown as swatches + a mini page mock."""
import pathlib
root = pathlib.Path(__file__).parent
mark = (root/"mark.svg").read_text().replace('viewBox="0 0 64 64" width="64" height="64"', 'viewBox="0 0 64 64" class="mk"')

# name, note, primary blue, accent, bg, surface, ink, muted, dark(bool)
P = [
 ("Royal + Tangerine", "Classic SaaS blue with a hot orange accent. Highest contrast pairing.", "#2B6CF0", "#FF6A1A", "#F6F5F0", "#FFFFFF", "#0E1A2B", "#5B6572", False),
 ("Cobalt + Lime", "Deeper blue, acid lime. Reads modern and a bit loud.", "#1E4FD8", "#C6F038", "#F4F6F9", "#FFFFFF", "#0B1430", "#5A6480", False),
 ("Sky + Coral", "Lighter, friendlier blue with a coral accent. Airbnb energy.", "#3B82F6", "#FF5A5F", "#FFFFFF", "#F5F8FC", "#111827", "#6B7280", False),
 ("Navy + Cyan", "Dark navy ink with electric cyan. Most 'tech' of the set.", "#1446C8", "#22D3EE", "#F2F5FA", "#FFFFFF", "#0B2A6F", "#4B5B7A", False),
 ("Indigo + Pink", "Blue pulled toward violet, hot pink accent. Consumer feel.", "#3451E8", "#FF3D8A", "#FAFAFF", "#FFFFFF", "#12123A", "#5C5E80", False),
 ("Ocean + Sunflower", "Trustworthy blue on warm cream with a yellow accent. Warmest option.", "#0A66C2", "#FFC532", "#FFFBF2", "#FFFFFF", "#14243A", "#5E6878", False),
 ("Periwinkle + Peach", "Soft blue, soft peach. Calm, more lifestyle than enterprise.", "#5B7CFA", "#FF9F6E", "#F7F6FF", "#FFFFFF", "#1C1D3D", "#666A8A", False),
 ("Deep blue + Mint", "The one option that keeps a green, as a cool mint accent.", "#1D3FBF", "#3DDC97", "#F3F7F5", "#FFFFFF", "#0F1F3D", "#56637A", False),
 ("Paper + Chartreuse", "Petra-style paper background, blue type, chartreuse accent.", "#2F5BE8", "#D4F23A", "#F5F1E8", "#FFFFFF", "#1A1A2E", "#6A6A7A", False),
 ("Night + Ember", "Dark ink background, bright blue, red-orange accent. For a dark site.", "#4D8DFF", "#FF4D1C", "#0B0F19", "#141A2A", "#F2F4F8", "#9AA3B5", True),
]

def mock(name, b, a, bg, sf, ink, mu, dark):
    line = "rgba(255,255,255,.08)" if dark else "rgba(0,0,0,.08)"
    return f'''
<div class="mock" style="background:{bg};color:{ink};--b:{b};--a:{a};--sf:{sf};--mu:{mu};--line:{line}">
  <div class="nav"><span class="brand">{mark}<span class="wm">soba</span></span><span class="links"><i>How it works</i><i>Pricing</i><b class="pill">Book a demo</b></span></div>
  <div class="hero">
    <span class="tag">After-hours sales desk</span>
    <h3>Every order answered. Even at 2 a.m.</h3>
    <p>Soba picks up the phone and the text line when your reps are off, takes the order in English or Spanish, and clears it against your price rules.</p>
    <div class="ctas"><b class="btn">Start free</b><b class="ghost">See a call</b></div>
  </div>
  <div class="cards">
    <div class="card"><small>Orders cleared tonight</small><strong class="acc">14</strong><em>3 waiting on a rep</em></div>
    <div class="card"><small>Avg. answer time</small><strong>4 s</strong><em>vs. next morning</em></div>
    <div class="card hl"><small>Rep approval</small><strong>1 tap</strong><em>Approve · Counter · Reject</em></div>
  </div>
</div>'''

cards = ""
for i, (name, note, b, a, bg, sf, ink, mu, dark) in enumerate(P, 1):
    sw = "".join(f'<span class="sw"><i style="background:{c}"></i>{lab}<code>{c}</code></span>' for lab, c in [("blue", b), ("accent", a), ("background", bg), ("surface", sf), ("ink", ink)])
    cards += f'''
<section class="pal">
  <div class="meta"><span class="n">{i:02d}</span><h2>{name}</h2><p>{note}</p><div class="sws">{sw}</div></div>
  {mock(name, b, a, bg, sf, ink, mu, dark)}
</section>'''

sheet = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Soba color palettes</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{{box-sizing:border-box}}body{{margin:0;background:#ECEEEA;color:#0E1A14;font-family:Inter,system-ui,sans-serif}}
.wrap{{max-width:1180px;margin:0 auto;padding:40px 20px 80px}}
h1{{font-family:Quicksand;font-size:28px;margin:0 0 6px}}.sub{{color:#667063;margin:0 0 28px}}
.pal{{display:grid;grid-template-columns:250px 1fr;gap:24px;background:#fff;border:1px solid #DDE0DA;border-radius:18px;padding:22px;margin-bottom:18px}}
.n{{font-size:12px;font-weight:600;color:#667063;letter-spacing:.08em}}h2{{font-family:Quicksand;font-size:19px;margin:4px 0 6px}}.meta p{{margin:0 0 14px;font-size:14px;color:#667063;line-height:1.45}}
.sws{{display:grid;gap:8px}}.sw{{display:flex;align-items:center;gap:10px;font-size:13px}}.sw i{{width:22px;height:22px;border-radius:7px;border:1px solid rgba(0,0,0,.08)}}.sw code{{margin-left:auto;color:#667063;font-size:12px}}
.mock{{border-radius:14px;padding:22px 26px;border:1px solid rgba(0,0,0,.06);overflow:hidden}}
.nav{{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;border-bottom:1px solid var(--line)}}
.brand{{display:flex;align-items:center;gap:8px}}.mk{{width:28px;height:28px}}.mk path{{stroke:var(--b)}}
.wm{{font-family:Quicksand;font-weight:700;font-size:24px;letter-spacing:-.02em;color:var(--b);line-height:1}}
.links{{display:flex;align-items:center;gap:18px;font-size:13px;color:var(--mu)}}.links i{{font-style:normal}}
.pill{{font-weight:600;color:var(--b);border:1.5px solid var(--b);border-radius:999px;padding:6px 12px;font-size:13px}}
.hero{{padding:30px 0 24px;max-width:560px}}
.tag{{display:inline-block;background:var(--a);color:#111;font-weight:600;font-size:12px;border-radius:999px;padding:4px 10px;margin-bottom:12px}}
h3{{font-family:Quicksand;font-weight:700;font-size:34px;line-height:1.1;margin:0 0 12px;letter-spacing:-.01em}}
.hero p{{margin:0 0 18px;color:var(--mu);font-size:15px;line-height:1.5}}
.ctas{{display:flex;gap:10px}}.btn{{background:var(--b);color:#fff;font-weight:600;font-size:14px;border-radius:10px;padding:10px 16px}}.ghost{{font-weight:600;font-size:14px;border-radius:10px;padding:10px 16px;border:1.5px solid var(--line);color:inherit}}
.cards{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}}
.card{{background:var(--sf);border:1px solid var(--line);border-radius:12px;padding:14px}}.card small{{font-size:12px;color:var(--mu)}}.card strong{{display:block;font-family:Quicksand;font-size:30px;margin:4px 0 2px}}.card strong.acc{{color:var(--a)}}.card em{{font-style:normal;font-size:12px;color:var(--mu)}}
.card.hl{{background:var(--b);border-color:var(--b);color:#fff}}.card.hl small,.card.hl em{{color:rgba(255,255,255,.75)}}
@media(max-width:860px){{.pal{{grid-template-columns:1fr}}.cards{{grid-template-columns:1fr}}}}
</style></head><body><div class="wrap">
<h1>Soba color palettes</h1><p class="sub">Ten palettes. Each one is a blue plus one eye-catching accent, shown as swatches and in a mini page mock with the clover and Quicksand wordmark.</p>
{cards}
</div></body></html>'''
(root/"palette-sheet.html").write_text(sheet)
print("wrote palette-sheet.html with", len(P), "palettes")
