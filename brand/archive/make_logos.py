"""Generate the 10 Soba logo-mark variations (64x64 SVG) and the review sheet."""
import pathlib

G = "#1DA462"   # soba green
B = "#2B6CF0"   # soba blue
T = "#15A3A0"   # overlap teal
INK = "#0E1A14"

# S built from two 270-degree arcs, round caps (the "noodle S")
S_PATH = "M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42"

def svg(body, defs=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
            f'{defs}{body}</svg>')

MARKS = {
 "01-noodle-s": ("Noodle S", "One continuous stroke, the S as a noodle. Flat green.",
   svg(f'<path d="{S_PATH}" fill="none" stroke="{G}" stroke-width="10" stroke-linecap="round"/>')),
 "02-noodle-s-gradient": ("Noodle S, gradient", "Same stroke, green running into blue along the curve. Stripe-style.",
   svg(f'<path d="{S_PATH}" fill="none" stroke="url(#gb)" stroke-width="10" stroke-linecap="round"/>',
       f'<defs><linearGradient id="gb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{G}"/><stop offset="1" stop-color="{B}"/></linearGradient></defs>')),
 "03-tile": ("Tile", "App-icon tile. Green square, white S. Evolves the current favicon.",
   svg(f'<rect width="64" height="64" rx="16" fill="{G}"/><path d="{S_PATH}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>')),
 "04-handoff": ("Handoff", "Two discs, green and blue, overlapping in teal. The desk handing over to the night shift.",
   svg(f'<circle cx="24" cy="32" r="17" fill="{G}"/><circle cx="40" cy="32" r="17" fill="{B}"/>'
       f'<path d="M32 17 A17 17 0 0 1 32 47 A17 17 0 0 1 32 17 Z" fill="{T}"/>')),
 "05-after-hours": ("After hours", "Blue disc with a green crescent. The after-hours signal.",
   svg(f'<circle cx="32" cy="32" r="22" fill="{B}"/><path d="M32 10 A22 22 0 0 0 32 54 A30 30 0 0 1 32 10 Z" fill="{G}"/>')),
 "06-bubble": ("Bubble", "Rounded speech bubble with the S inside. It answers texts and calls.",
   svg(f'<path d="M14 10 h36 a8 8 0 0 1 8 8 v26 a8 8 0 0 1 -8 8 h-24 l-10 8 v-8 h-2 a8 8 0 0 1 -8 -8 v-26 a8 8 0 0 1 8 -8 z" fill="{G}"/>'
       f'<path d="M40 22 A8 8 0 1 0 32 30 A8 8 0 1 1 24 38" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>')),
 "07-voice": ("Voice", "Four rounded bars, green through blue. A voice line that is always answered.",
   svg(f'<rect x="10" y="26" width="8" height="12" rx="4" fill="{G}"/>'
       f'<rect x="22" y="14" width="8" height="36" rx="4" fill="{G}"/>'
       f'<rect x="34" y="20" width="8" height="24" rx="4" fill="{T}"/>'
       f'<rect x="46" y="8" width="8" height="48" rx="4" fill="{B}"/>')),
 "08-leaves": ("Two leaves", "Two quarter-discs meeting at the center. Reads as leaves and as an S turned.",
   svg(f'<path d="M32 32 V12 A20 20 0 0 0 12 32 Z" fill="{G}"/><path d="M32 32 V52 A20 20 0 0 0 52 32 Z" fill="{B}"/>')),
 "09-leaf": ("Leaf", "One lens-shaped leaf in green, a single blue midrib. The produce reference.",
   svg(f'<path d="M14 50 Q14 14 50 14 Q50 50 14 50 Z" fill="{G}"/><path d="M18 46 L46 18" stroke="{B}" stroke-width="3.5" stroke-linecap="round"/>')),
 "10-ring": ("Ring", "Thin blue ring, green S. Monogram for stamps, avatars, favicons.",
   svg(f'<circle cx="32" cy="32" r="27" fill="none" stroke="{B}" stroke-width="4"/>'
       f'<path d="{S_PATH}" fill="none" stroke="{G}" stroke-width="8" stroke-linecap="round"/>')),
 # --- nature set ---
 "11-river": ("River", "Green field tile, the S as a blue river winding through it.",
   svg(f'<rect width="64" height="64" rx="16" fill="{G}"/><path d="{S_PATH}" fill="none" stroke="{B}" stroke-width="9" stroke-linecap="round"/>')),
 "12-sprout": ("Sprout", "Two green leaves on a blue stem. A seedling, the first order of the night.",
   svg(f'<path d="M32 58 V30" stroke="{B}" stroke-width="5" stroke-linecap="round"/>'
       f'<path d="M32 38 Q14 38 12 20 Q30 20 32 38 Z" fill="{G}"/><path d="M32 32 Q50 32 52 14 Q34 14 32 32 Z" fill="{G}"/>')),
 "13-dawn": ("Dawn", "Half a blue sun on a green field. The morning summary.",
   svg(f'<path d="M12 40 A20 20 0 0 1 52 40 Z" fill="{B}"/><rect x="6" y="40" width="52" height="14" rx="7" fill="{G}"/>')),
 "14-hills": ("Hills", "Two rounded hills, blue behind, green in front.",
   svg(f'<path d="M20 58 A20 20 0 0 1 60 58 Z" fill="{B}"/><path d="M4 58 A20 20 0 0 1 44 58 Z" fill="{G}"/>')),
 "15-drop": ("Drop", "Blue water drop with a green leaf inside. Irrigation and produce.",
   svg(f'<path d="M32 6 C32 6 13 28 13 40 A19 19 0 0 0 51 40 C51 28 32 6 32 6 Z" fill="{B}"/>'
       f'<path d="M24 48 Q24 32 40 32 Q40 48 24 48 Z" fill="{G}"/>')),
 "16-seed": ("Seed", "Green half-fruit with a blue seed. The avocado without saying avocado.",
   svg(f'<path d="M32 6 Q58 32 32 58 Q6 32 32 6 Z" fill="{G}"/><circle cx="32" cy="34" r="9" fill="{B}"/>')),
 "17-clover": ("Clover", "Three leaves around one point, two green and one blue.",
   svg(f'<g transform="translate(32 36)"><path d="M0 0 Q-15 -11 0 -27 Q15 -11 0 0 Z" fill="{G}"/>'
       f'<path d="M0 0 Q-15 -11 0 -27 Q15 -11 0 0 Z" fill="{G}" transform="rotate(120)"/>'
       f'<path d="M0 0 Q-15 -11 0 -27 Q15 -11 0 0 Z" fill="{B}" transform="rotate(240)"/></g>')),
 "18-night-field": ("Night field", "Blue crescent moon over a green field. After hours, on the farm.",
   svg(f'<path d="M26 10 A13 13 0 0 0 26 36 A17 17 0 0 1 26 10 Z" fill="{B}"/><path d="M0 64 Q32 40 64 64 Z" fill="{G}"/>')),
 "19-branch": ("Branch", "Blue stem, three green leaves alternating sides.",
   svg(f'<path d="M32 58 V10" stroke="{B}" stroke-width="4" stroke-linecap="round"/>'
       f'<path d="M0 0 Q-12 -10 0 -24 Q12 -10 0 0 Z" fill="{G}" transform="translate(32 46) rotate(-62)"/>'
       f'<path d="M0 0 Q-12 -10 0 -24 Q12 -10 0 0 Z" fill="{G}" transform="translate(32 34) rotate(62)"/>'
       f'<path d="M0 0 Q-12 -10 0 -24 Q12 -10 0 0 Z" fill="{G}" transform="translate(32 22) rotate(-62)"/>')),
 "20-furrows": ("Furrows", "Three field rows in perspective, green at the front, blue at the horizon.",
   svg(f'<path d="M6 52 Q32 38 58 52" stroke="{G}" stroke-width="6" stroke-linecap="round" fill="none"/>'
       f'<path d="M11 38 Q32 27 53 38" stroke="{T}" stroke-width="6" stroke-linecap="round" fill="none"/>'
       f'<path d="M16 24 Q32 16 48 24" stroke="{B}" stroke-width="6" stroke-linecap="round" fill="none"/>')),
}

root = pathlib.Path(__file__).parent
for key, (_, _, body) in MARKS.items():
    (root / "logos" / f"{key}.svg").write_text(body.replace(' class="bg"', ''))

cards = ""
for i, (key, (name, note, body)) in enumerate(MARKS.items(), 1):
    mark = body.replace('viewBox="0 0 64 64" width="64" height="64"', 'viewBox="0 0 64 64" class="mk"')
    def lockup(theme):
        return (f'<div class="lk {theme}">{mark}<span class="wm">soba</span></div>')
    cards += f'''
<section class="card">
  <div class="meta"><span class="n">{i:02d}</span><h2>{name}</h2><p>{note}</p><code>brand/logos/{key}.svg</code></div>
  <div class="rows">
    {lockup("light")}
    {lockup("dark")}
    <div class="small light">{mark}{mark.replace('class="mk"','class="mk s32"')}{mark.replace('class="mk"','class="mk s16"')}<span class="cap">64 · 32 · 16 px</span></div>
  </div>
</section>'''

sheet = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Soba logo variations</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
<style>
:root{{--ink:{INK};--muted:#667063;--line:#e1e5dc;--bg:#f2f4ef;--g:{G};--b:{B}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font-family:"Plus Jakarta Sans",system-ui,sans-serif}}
.wrap{{max-width:1100px;margin:0 auto;padding:40px 20px 80px}}
h1{{font-size:28px;margin:0 0 6px;letter-spacing:-.02em}}.sub{{color:var(--muted);margin:0 0 28px}}
.sw{{display:flex;gap:10px;margin:0 0 32px}}.sw span{{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}}.sw i{{width:18px;height:18px;border-radius:5px;display:inline-block}}
.card{{display:grid;grid-template-columns:260px 1fr;gap:24px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;margin-bottom:16px}}
.n{{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.08em}}h2{{font-size:18px;margin:4px 0 6px}}.meta p{{margin:0 0 10px;font-size:14px;color:var(--muted);line-height:1.45}}code{{font-size:12px;color:var(--muted)}}
.rows{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}}
.lk,.small{{border-radius:14px;display:flex;align-items:center;gap:14px;padding:22px 24px;min-height:120px}}
.light{{background:#f2f4ef;border:1px solid var(--line)}}.dark{{background:#0f1310}}.dark .wm{{color:#e7ece5}}
.dark .bg{{fill:#0f1310}}.light .bg{{fill:#f2f4ef}}
.mk{{width:44px;height:44px;flex:none}}.s32{{width:32px;height:32px}}.s16{{width:16px;height:16px}}
.wm{{font-weight:800;font-size:34px;letter-spacing:-.045em;line-height:1;color:var(--ink)}}
.small{{gap:16px;flex-wrap:wrap}}.cap{{flex-basis:100%;font-size:12px;color:var(--muted);white-space:nowrap}}
@media(max-width:860px){{.card{{grid-template-columns:1fr}}.rows{{grid-template-columns:1fr}}}}
</style></head><body><div class="wrap">
<h1>Soba logo variations</h1><p class="sub">Twenty marks, each shown as a lockup on light and dark, then at favicon sizes. Wordmark is Plus Jakarta Sans 800, lowercase.</p>
<div class="sw"><span><i style="background:{G}"></i>green {G}</span><span><i style="background:{B}"></i>blue {B}</span><span><i style="background:{T}"></i>teal {T}</span><span><i style="background:{INK}"></i>ink {INK}</span></div>
{cards}
</div></body></html>'''
(root / "logo-sheet.html").write_text(sheet)
print("wrote", len(MARKS), "marks + logo-sheet.html")
