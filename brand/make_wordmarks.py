"""Wordmark sheet: 'soba' set in 16 typefaces next to the chosen blue outline clover."""
import pathlib
B, INK = "#2B6CF0", "#0E1A14"
root = pathlib.Path(__file__).parent
mark = (root/"mark.svg").read_text().replace('viewBox="0 0 64 64" width="64" height="64"', 'viewBox="0 0 64 64" class="mk"')

# (label, css family, weight, letter-spacing, source) source: g=Google Fonts, f=Fontshare
FONTS = [
 ("Plus Jakarta Sans", "Plus Jakarta Sans", 800, "-.045em", "g"),
 ("Inter", "Inter", 700, "-.05em", "g"),
 ("Manrope", "Manrope", 800, "-.04em", "g"),
 ("Outfit", "Outfit", 700, "-.03em", "g"),
 ("DM Sans", "DM Sans", 700, "-.04em", "g"),
 ("Space Grotesk", "Space Grotesk", 700, "-.03em", "g"),
 ("Figtree", "Figtree", 800, "-.04em", "g"),
 ("Bricolage Grotesque", "Bricolage Grotesque", 700, "-.02em", "g"),
 ("Sora", "Sora", 700, "-.04em", "g"),
 ("Urbanist", "Urbanist", 800, "-.03em", "g"),
 ("Geist", "Geist", 700, "-.04em", "g"),
 ("Onest", "Onest", 700, "-.04em", "g"),
 ("Quicksand", "Quicksand", 700, "-.02em", "g"),
 ("Instrument Sans", "Instrument Sans", 700, "-.04em", "g"),
 ("General Sans", "General Sans", 700, "-.03em", "f"),
 ("Satoshi", "Satoshi", 900, "-.03em", "f"),
]
gfam = "&".join(f"family={f[1].replace(' ', '+')}:wght@500;{f[2]}" for f in FONTS if f[4]=="g")
ffam = "&".join(f"f[]={f[1].lower().replace(' ', '-')}@500,{f[2]}" for f in FONTS if f[4]=="f")

cards = ""
for i, (label, fam, w, ls, src) in enumerate(FONTS, 1):
    st = f'font-family:\'{fam}\';font-weight:{w};letter-spacing:{ls}'
    cards += f'''
<section class="card">
  <div class="meta"><span class="n">{i:02d}</span><h2>{label}</h2><p>{w} weight, lowercase. {'Google Fonts' if src=='g' else 'Fontshare'}.</p></div>
  <div class="lk light">{mark}<span class="wm blue" style="{st}">soba</span></div>
</section>'''

sheet = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Soba wordmark variations</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?{gfam}&display=swap" rel="stylesheet">
<link href="https://api.fontshare.com/v2/css?{ffam}&display=swap" rel="stylesheet">
<style>
:root{{--ink:{INK};--muted:#667063;--line:#e1e5dc;--bg:#f2f4ef;--b:{B}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font-family:"Plus Jakarta Sans",system-ui,sans-serif}}
.wrap{{max-width:1180px;margin:0 auto;padding:40px 20px 80px}}
h1{{font-size:28px;margin:0 0 6px;letter-spacing:-.02em}}.sub{{color:var(--muted);margin:0 0 28px}}
.card{{display:grid;grid-template-columns:220px 1fr;gap:24px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;margin-bottom:16px}}
.n{{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.08em}}h2{{font-size:18px;margin:4px 0 6px}}.meta p{{margin:0;font-size:14px;color:var(--muted);line-height:1.45}}
.rows{{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px}}
.lk{{border-radius:14px;display:flex;align-items:center;gap:16px;padding:28px 32px;min-height:120px}}
.light{{background:#f2f4ef;border:1px solid var(--line)}}.dark{{background:#0f1310}}.dark .wm{{color:#e7ece5}}
.mk{{width:56px;height:56px;flex:none}}
.wm{{font-size:48px;line-height:1;color:var(--ink)}}.wm.blue{{color:var(--b)}}
@media(max-width:1180px){{.rows{{grid-template-columns:1fr 1fr}}}}@media(max-width:720px){{.card{{grid-template-columns:1fr}}.rows{{grid-template-columns:1fr}}}}
</style></head><body><div class="wrap">
<h1>Soba wordmark variations</h1><p class="sub">Sixteen typefaces. One lockup each: blue outline clover, blue lowercase soba.</p>
{cards}
</div></body></html>'''
(root/"wordmark-sheet.html").write_text(sheet)
print("wrote wordmark-sheet.html with", len(FONTS), "fonts")
