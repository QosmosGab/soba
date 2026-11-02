import pathlib, re
root = pathlib.Path(__file__).parent
head, header, footer = (root/"_head.html").read_text(), (root/"_header.html").read_text(), (root/"_footer.html").read_text()
for src in (root/"src").glob("*.html"):
    body = src.read_text()
    m = re.search(r"<title>.*?</title>\s*(<meta[^>]*>\s*)*", body, re.S)
    meta, rest = body[:m.end()], body[m.end():]
    html = f'<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n{meta}{head}</head>\n<body>\n{header}{rest}{footer}</body>\n</html>\n'
    (root/src.name).write_text(html)
    print("built", src.name)
