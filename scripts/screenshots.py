"""Screenshots and page renders for the README (assets/rendered/screens/).

Run after building:  npm run build:all -- --allow-short && npm run app:build
(the Publish screenshot builds a practice package inside the app, so it takes a few seconds)
Then:                python scripts/screenshots.py

Needs Playwright for Python with Chromium, Pillow, and `pdftoppm` (poppler-utils).
App screenshots are taken in light and dark mode; book pages are paper, so light only.
Re-running overwrites the PNGs; nothing here is edited by hand.
"""

from __future__ import annotations

import html
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
OUT = ROOT / "assets" / "rendered" / "screens"
APP = ROOT / "web" / "dist"
GRAY = (128, 128, 128)
PAPER_BG = {"light": (246, 248, 250), "dark": (13, 17, 23)}
FONT = (ROOT / "node_modules/source-sans/TTF/SourceSans3-Regular.ttf").as_uri()
MONO = "DejaVu Sans Mono, monospace"


def need(path: Path, hint: str) -> None:
    if not path.exists():
        sys.exit(f"Missing {path.relative_to(ROOT)} — run: {hint}")


def pdf_pages(pdf: Path, first: int, last: int, dpi: int = 110) -> list[Image.Image]:
    tmp = Path(tempfile.mkdtemp())
    subprocess.run(["pdftoppm", "-r", str(dpi), "-png", "-f", str(first), "-l", str(last), str(pdf), str(tmp / "p")], check=True)
    pages = [Image.open(p).convert("RGB") for p in sorted(tmp.glob("p-*.png"))]
    shutil.rmtree(tmp)
    return pages


def frame(img: Image.Image, pad: int = 2) -> Image.Image:
    """A thin gray outline so white pages read against a white README."""
    out = Image.new("RGB", (img.width + 2 * pad, img.height + 2 * pad), (208, 215, 222))
    out.paste(img, (pad, pad))
    return out


def row(images: list[Image.Image], gap: int = 24, bg=(255, 255, 255), height: int | None = None) -> Image.Image:
    if height:
        images = [i.resize((round(i.width * height / i.height), height), Image.LANCZOS) for i in images]
    h = max(i.height for i in images)
    w = sum(i.width for i in images) + gap * (len(images) - 1)
    out = Image.new("RGB", (w, h), bg)
    x = 0
    for i in images:
        out.paste(i, (x, (h - i.height) // 2))
        x += i.width + gap
    return out


def save(img: Image.Image, name: str, max_w: int = 1760) -> None:
    if img.width > max_w:
        img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / name, optimize=True)
    print(f"  wrote {(OUT / name).relative_to(ROOT)} ({img.width}×{img.height})")


def serve(directory: Path) -> tuple[ThreadingHTTPServer, str]:
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *args) -> None:  # keep the console readable
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(directory)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}/"


def text_panel(page, lines: str, width: int, height: int, title: str) -> Image.Image:
    """Render monospaced text (build output, JSON) as an image with Chromium."""
    doc = f"""<html><head><style>@font-face{{font-family:S;src:url('{FONT}')}}
body{{margin:0;background:#0D1117;color:#E6EDF3;font:15px/1.45 {MONO};}}
.t{{font:600 14px S,sans-serif;color:#8B949E;padding:14px 18px 0}} pre{{margin:0;padding:10px 18px 18px;white-space:pre-wrap}}
.ok{{color:#2BC495}} .bad{{color:#E0651F}} .warn{{color:#E69F00}}</style></head>
<body><div class="t">{html.escape(title)}</div><pre>{lines}</pre></body></html>"""
    page.set_viewport_size({"width": width, "height": height})
    page.set_content(doc)
    tmp = Path(tempfile.mkdtemp()) / "t.png"
    page.screenshot(path=str(tmp), full_page=False)
    return Image.open(tmp).convert("RGB")


def color_build_output(raw: str) -> str:
    out = []
    for line in raw.splitlines():
        esc = html.escape(line)
        cls = "ok" if line.lstrip().startswith("✓") else "bad" if line.lstrip().startswith("✗") else "warn" if line.lstrip().startswith("!") else ""
        out.append(f'<span class="{cls}">{esc}</span>' if cls else esc)
    return "\n".join(out)


def main() -> None:
    need(DIST / "rc-circuits" / "book.pdf", "npm run build:all -- --allow-short")
    need(APP / "index.html", "npm run app:build")
    srv, url = serve(APP)
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # 1–4. The app, light and dark: Write, Edit, Publish (practice package from a sample), 3D viewer.
        for mode in ("light", "dark"):
            suffix = "" if mode == "light" else ".dark"
            ctx = browser.new_context(viewport={"width": 1280, "height": 820}, device_scale_factor=1.5, color_scheme=mode, reduced_motion="reduce", accept_downloads=True)
            pg = ctx.new_page()
            pg.goto(url)
            pg.wait_for_selector("form.write")
            pg.locator("textarea[name=topic]").fill("How lithium-ion batteries store and release energy")
            pg.screenshot(path=str(OUT / f"app-write{suffix}.png"))
            print(f"  wrote assets/rendered/screens/app-write{suffix}.png")
            pg.goto(url + "#sample=rc-circuits")
            pg.wait_for_selector(".editor")
            pg.get_by_role("button", name="Dismiss").click()
            pg.get_by_role("tab", name="Edit").click()
            pg.locator(".nav-item.section").nth(2).click()
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(OUT / f"app-edit{suffix}.png"))
            print(f"  wrote assets/rendered/screens/app-edit{suffix}.png")
            pg.locator(".step", has_text="Publish").click()
            pg.get_by_role("button", name="Build and check the package").click()
            pg.wait_for_selector(".results .check-group", timeout=180000)
            pg.locator(".publish-steps > li").nth(1).scroll_into_view_if_needed()
            pg.mouse.wheel(0, -120)
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(OUT / f"app-publish{suffix}.png"))
            print(f"  wrote assets/rendered/screens/app-publish{suffix}.png")
            pg.goto(url + "#sample=cells-and-dna")
            pg.wait_for_selector(".viewer3d")
            fig = pg.locator("figure.model3d").first
            fig.scroll_into_view_if_needed()
            stage = pg.locator(".viewer3d [role=img]").first
            box = stage.bounding_box()
            # rotate a little by dragging, the way a reader would
            pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            pg.mouse.down()
            pg.mouse.move(box["x"] + box["width"] / 2 + 40, box["y"] + box["height"] / 2 - 25, steps=6)
            pg.mouse.up()
            pg.wait_for_timeout(200)
            fig.screenshot(path=str(OUT / f"app-3d{suffix}.png"))
            print(f"  wrote assets/rendered/screens/app-3d{suffix}.png")
            ctx.close()

        page = browser.new_page(device_scale_factor=1.5)

        # 4. Print spread from the engineering sample (pages 14–15: the charging circuit and the time constant).
        spread = row([frame(i) for i in pdf_pages(DIST / "rc-circuits" / "book.pdf", 14, 15)], gap=0, bg=PAPER_BG["light"])
        save(spread, "print-spread.png")

        # 5. Gallery: one page per profile.
        picks = [("rc-circuits", 16), ("molecular-shapes", 8), ("cells-and-dna", 10), ("heart-and-vessels", 10)]
        save(row([frame(pdf_pages(DIST / d / "book.pdf", n, n)[0]) for d, n in picks], gap=28, bg=PAPER_BG["light"], height=1000), "gallery.png")

        # 6. Before / after: a section's drafted JSON next to its typeset page.
        book = json.loads((ROOT / "examples/rc-circuits/book.json").read_text())
        eq = next(b for ch in book["chapters"] for s in ch["sections"] for b in s["layers"]["formal"] if b.get("id") == "eq-tau")
        snippet = json.dumps({k: eq[k] for k in ("kind", "id", "intuition", "latex", "where", "example", "validity")}, indent=2, ensure_ascii=False)
        left = text_panel(page, html.escape(snippet), 620, 980, "Drafted section (JSON, schema-checked)")
        right = frame(pdf_pages(DIST / "rc-circuits" / "book.pdf", 14, 14)[0])
        save(row([left, right], gap=28, bg=PAPER_BG["light"], height=980), "before-after.png")

        # 7. KDP outputs: build log, full-wrap cover, ebook cover.
        log = subprocess.run(["npx", "tsx", "src/cli/main.ts", "build", "examples/rc-circuits", "--epubcheck"], cwd=ROOT, capture_output=True, text=True).stdout
        log = "\n".join(l for l in log.splitlines() if l.strip() and not l.startswith(">"))
        panel = text_panel(page, color_build_output(log), 760, 520, "npm run build -- examples/rc-circuits --epubcheck")
        cover = frame(pdf_pages(DIST / "rc-circuits" / "cover.pdf", 1, 1, dpi=80)[0])
        ebook = frame(Image.open(DIST / "rc-circuits" / "ebook-cover.jpg").convert("RGB"))
        save(row([panel, cover, ebook], gap=28, bg=PAPER_BG["light"], height=640), "kdp-outputs.png")

        # 8. The EPUB at phone width: reflowable text with a MathML equation.
        tmp = Path(tempfile.mkdtemp())
        with zipfile.ZipFile(DIST / "rc-circuits" / "book.epub") as z:
            z.extractall(tmp)
        page.set_viewport_size({"width": 390, "height": 760})
        page.goto((tmp / "OEBPS" / "chapter-2.xhtml").as_uri())
        page.locator("#eq-tau").scroll_into_view_if_needed()
        page.mouse.wheel(0, -60)
        page.screenshot(path=str(OUT / "epub-phone.png"))
        print("  wrote assets/rendered/screens/epub-phone.png")
        browser.close()
    srv.shutdown()


if __name__ == "__main__":
    main()
