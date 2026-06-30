#!/usr/bin/env python3
"""Generate the macOS menu-bar (tray) template icon: black concentric rings on a
transparent background. Pure stdlib (zlib + struct), no Pillow required.

Outputs resources/trayTemplate.png (16px) and resources/trayTemplate@2x.png (32px).
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "resources")

# Design in a 22x22 box: rings at r=9,6,3 (stroke 2) + centre dot r=1.6.
DESIGN = 22.0
RINGS = [9.0, 6.0, 3.0]
STROKE = 2.0
DOT = 1.6


def smoothstep(edge0, edge1, x):
    if edge1 == edge0:
        return 0.0 if x < edge0 else 1.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def coverage(px, py, size):
    s = size / DESIGN
    cx = cy = size / 2.0
    dx, dy = px + 0.5 - cx, py + 0.5 - cy
    dist = (dx * dx + dy * dy) ** 0.5
    half = (STROKE * s) / 2.0
    aa = 0.75  # antialiasing band in px
    a = 0.0
    for r in RINGS:
        R = r * s
        edge = abs(dist - R)
        a = max(a, 1.0 - smoothstep(half - aa, half + aa, edge))
    # centre dot
    rc = DOT * s
    a = max(a, 1.0 - smoothstep(rc - aa, rc + aa, dist))
    return max(0.0, min(1.0, a))


def make_png(size, path):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0
        for x in range(size):
            a = int(round(coverage(x, y, size) * 255))
            raw += bytes((0, 0, 0, a))  # black, variable alpha

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path)


os.makedirs(RES, exist_ok=True)
make_png(16, os.path.join(RES, "trayTemplate.png"))
make_png(32, os.path.join(RES, "trayTemplate@2x.png"))
