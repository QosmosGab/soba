"""Clover variations for Soba, each emitted in solid green and solid blue."""
import pathlib

G, B, INK = "#1DA462", "#2B6CF0", "#0E1A14"
LENS   = "M0 0 Q-15 -11 0 -27 Q15 -11 0 0 Z"
LENS4  = "M0 0 Q-13 -10 0 -25 Q13 -10 0 0 Z"
PETAL  = "M0 0 C-14 -10 -14 -28 0 -28 C14 -28 14 -10 0 0 Z"
HEART  = "M0 0 C-14 -8 -16 -22 -8 -26 C-3 -28 0 -24 0 -22 C0 -24 3 -28 8 -26 C16 -22 14 -8 0 0 Z"
GAP    = "M0 -4 Q-15 -15 0 -31 Q15 -15 0 -4 Z"

def leaves(path, n, fill, cx=32, cy=36, scale=1, stroke=None):
    attrs = f'fill="{fill}"' if not stroke else f'fill="none" stroke="{stroke}" stroke-width="4" stroke-linejoin="round"'
    inner = "".join(f'<path d="{path}" {attrs} transform="rotate({360*i/n})"/>' for i in range(n))
    return f'<g transform="translate({cx} {cy}) scale({scale})">{inner}</g>'

def svg(body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">{body}</svg>'

def variants(c):
    return {
     "01-lens":    ("Lens", "The current clover, one color.", svg(leaves(LENS, 3, c))),
     "02-petal":   ("Petal", "Rounder leaf tips, same three-around-one-point.", svg(leaves(PETAL, 3, c))),
     "03-heart":   ("Heart leaf", "True clover leaves, each with a notch at the tip.", svg(leaves(HEART, 3, c))),
     "04-four":    ("Four leaf", "Four lens leaves. Reads as a clover and as a cross.", svg(leaves(LENS4, 4, c))),
     "05-gap":     ("Gap", "Leaves pulled off the center so a small hole shows.", svg(leaves(GAP, 3, c))),
     "06-stem":    ("Stem", "Three leaves with a short stem curling off to the right.",
                    svg(f'<path d="M32 30 Q33 42 40 52" stroke="{c}" stroke-width="4.5" stroke-linecap="round" fill="none"/>' + leaves(LENS, 3, c, cy=30))),
     "07-hub":     ("Hub", "Leaves overlapping with a small open dot at the center.",
                    svg(leaves(PETAL, 3, c) + f'<circle cx="32" cy="36" r="5" fill="#fff" class="bg"/>')),
     "08-outline": ("Outline", "Stroke only, no fill. Lighter on the page.", svg(leaves(LENS, 3, c, stroke=c))),
     "09-tile":    ("Tile", "White clover knocked out of a colored app tile.",
                    svg(f'<rect width="64" height="64" rx="16" fill="{c}"/>' + leaves(PETAL, 3, "#fff", cy=35, scale=0.82))),
     "10-ring":    ("Ring", "Clover inside a thin ring of the same color.",
                    svg(f'<circle cx="32" cy="32" r="27" fill="none" stroke="{c}" stroke-width="4"/>' + leaves(LENS, 3, c, cy=34, scale=0.68))),
     "11-dots":    ("Dots", "Three discs overlapping. The clover reduced to its simplest form.",
                    svg("".join(f'<circle cx="32" cy="22" r="12" fill="{c}" transform="rotate({120*i} 32 34)"/>' for i in range(3)))),
     "12-tilt":    ("Tilt", "The lens clover turned so one leaf points up and right, like it is growing.",
                    svg(f'<g transform="rotate(30 32 36)">' + leaves(LENS, 3, c) + '</g>')),
    }

root = pathlib.Path(__file__).parent
green, blue = variants(G), variants(B)
for key in green:
    (root/"logos"/f"clover-{key}-green.svg").write_text(green[key][2].replace(' class="bg"',''))
    (root/"logos"/f"clover-{key}-blue.svg").write_text(blue[key][2].replace(' class="bg"',''))

def mk(body): return body.replace('viewBox="0 0 64 64" width="64" height="64"', 'viewBox="0 0 64 64" class="mk"')
cards = ""
for i, key in enumerate(green, 1):
    name, note, gbody = green[key]; bbody = blue[key][2]
    cards += f'''
<section class="card">
  <div class="meta"><span class="n">{i:02d}</span><h2>{name}</h2><p>{note}</p><code>brand/logos/clover-{key}-green.svg<br>brand/logos/clover-{key}-blue.svg</code></div>
  <div class="rows">
    <div class="lk light">{mk(gbody)}<span class="wm">soba</span></div>
    <div class="lk light">{mk(bbody)}<span class="wm">soba</span></div>
    <div class="lk dark">{mk(gbody)}<span class="wm">soba</span></div>
    <div class="lk dark">{mk(bbody)}<span class="wm">soba</span></div>
    <div class="small light">{mk(gbody)}{mk(gbody).replace('class="mk"','class="mk s32"')}{mk(gbody).replace('class="mk"','class="mk s16"')}<i></i>{mk(bbody)}{mk(bbody).replace('class="mk"','class="mk s32"')}{mk(bbody).replace('class="mk"','class="mk s16"')}<span class="cap">64 · 32 · 16 px</span></div>
  </div>
</section>'''

sheet = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Soba clover variations</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
<style>
:root{{--ink:{INK};--muted:#667063;--line:#e1e5dc;--bg:#f2f4ef}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font-family:"Plus Jakarta Sans",system-ui,sans-serif}}
.wrap{{max-width:1180px;margin:0 auto;padding:40px 20px 80px}}
h1{{font-size:28px;margin:0 0 6px;letter-spacing:-.02em}}.sub{{color:var(--muted);margin:0 0 28px}}
.card{{display:grid;grid-template-columns:230px 1fr;gap:24px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;margin-bottom:16px}}
.n{{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.08em}}h2{{font-size:18px;margin:4px 0 6px}}.meta p{{margin:0 0 10px;font-size:14px;color:var(--muted);line-height:1.45}}code{{font-size:11px;color:var(--muted);line-height:1.6}}
.rows{{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px}}
.lk{{border-radius:14px;display:flex;align-items:center;gap:12px;padding:22px 20px;min-height:110px}}
.light{{background:#f2f4ef;border:1px solid var(--line)}}.dark{{background:#0f1310}}.dark .wm{{color:#e7ece5}}
.dark .bg{{fill:#0f1310}}.light .bg{{fill:#f2f4ef}}
.mk{{width:42px;height:42px;flex:none}}.s32{{width:32px;height:32px}}.s16{{width:16px;height:16px}}
.wm{{font-weight:800;font-size:30px;letter-spacing:-.045em;line-height:1;color:var(--ink)}}
.small{{grid-column:1/-1;border-radius:14px;display:flex;align-items:center;gap:14px;padding:16px 20px}}.small i{{width:1px;height:32px;background:var(--line);margin:0 10px}}.cap{{font-size:12px;color:var(--muted);margin-left:auto}}
@media(max-width:1180px){{.rows{{grid-template-columns:1fr 1fr}}}}@media(max-width:720px){{.card{{grid-template-columns:1fr}}.rows{{grid-template-columns:1fr}}}}
</style></head><body><div class="wrap">
<h1>Soba clover variations</h1><p class="sub">Twelve clovers, each in solid green and solid blue, on light and dark, then at favicon sizes. No mixed colors.</p>
{cards}
</div></body></html>'''
(root/"clover-sheet.html").write_text(sheet)
print("wrote", len(green)*2, "svgs + clover-sheet.html")
