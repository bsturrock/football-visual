#!/usr/bin/env python3
"""Headless screenshots of tools/compare for review.

    python3 tools/compare/shoot.py [out_dir]     (serves the repo itself on a free port)

Writes one PNG per view/zoom plus contact sheets.
"""
import http.server, socketserver, sys, threading, functools
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'analysis/compare')
OUT.mkdir(parents=True, exist_ok=True)

SHOTS = [
    ('full_front', 'view=front'), ('full_side', 'view=side'), ('full_back', 'view=back'),
    ('full_34', 'view=threequarter'), ('broadcast', 'view=broadcast'),
    ('head_front', 'view=front&zoom=head'), ('head_side', 'view=side&zoom=head'), ('head_34', 'view=threequarter&zoom=head'),
    ('arm_front', 'view=front&zoom=arm&mode=overlay&opacity=0.45'), ('leg_side', 'view=side&zoom=leg'),
    ('torso_front', 'view=front&zoom=torso'), ('torso_34', 'view=threequarter&zoom=torso'), ('torso_side', 'view=side&zoom=torso'),
    ('rest_front', 'view=front&pose=rest'), ('rest_34', 'view=threequarter&pose=rest'),
    ('overlay_front', 'view=front&mode=overlay&opacity=0.45'), ('overlay_side', 'view=side&mode=overlay&opacity=0.45'),
]

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
handler.log_message = lambda *a: None
srv = socketserver.TCPServer(('127.0.0.1', 0), handler)   # any free port
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1200, 'height': 800})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    for name, qs in SHOTS:
        pg.goto(f'http://127.0.0.1:{PORT}/tools/compare/index.html?ui=0&{qs}')
        pg.wait_for_function('window.__ready === true', timeout=120000)
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(OUT / f'{name}.png'))
    stats = pg.evaluate("document.getElementById('stats').textContent")
    b.close()
srv.shutdown()

def sheet(names, out, cols=3):
    ims = [Image.open(OUT / f'{n}.png').convert('RGB').resize((600, 400)) for n in names]
    rows = (len(ims) + cols - 1) // cols
    s = Image.new('RGB', (600 * cols, 400 * rows), 'white')
    for i, im in enumerate(ims): s.paste(im, ((i % cols) * 600, (i // cols) * 400))
    s.save(OUT / out)

sheet(['full_front', 'full_side', 'full_back', 'full_34', 'broadcast', 'overlay_front'], 'sheet_body.png')
sheet(['torso_front', 'torso_34', 'torso_side', 'arm_front', 'leg_side', 'overlay_side'], 'sheet_detail.png')
print(stats)
print('errors:', errors or 'none')
