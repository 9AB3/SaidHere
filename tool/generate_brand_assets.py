#!/usr/bin/env python3
"""Replace generated Flutter placeholder PNGs with simple SaidHere brand assets."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAPER = (243, 239, 228, 255)
INK = (21, 21, 21, 255)
BLUE = (104, 128, 139, 255)


def png_size(path: Path) -> tuple[int, int] | None:
    try:
        data = path.read_bytes()
        if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
            return None
        return struct.unpack('>II', data[16:24])
    except OSError:
        return None


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png(path: Path, width: int, height: int, pixels: bytearray) -> None:
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        start = y * stride
        raw.extend(pixels[start:start + stride])
    payload = b'\x89PNG\r\n\x1a\n'
    payload += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    payload += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    payload += chunk(b'IEND', b'')
    path.write_bytes(payload)


def paint_rect(pixels: bytearray, width: int, height: int, x0: int, y0: int, x1: int, y1: int, rgba: tuple[int, int, int, int]) -> None:
    x0, x1 = max(0, x0), min(width, x1)
    y0, y1 = max(0, y0), min(height, y1)
    for y in range(y0, y1):
        for x in range(x0, x1):
            i = (y * width + x) * 4
            pixels[i:i + 4] = bytes(rgba)


def make_icon(width: int, height: int) -> bytearray:
    pixels = bytearray(PAPER * (width * height))
    unit = min(width, height)
    left = int(width * .18)
    right = int(width * .82)
    top = int(height * .18)
    bottom = int(height * .82)

    paint_rect(pixels, width, height, left, top, right, bottom, INK)
    pad = max(1, int(unit * .065))
    paint_rect(pixels, width, height, left + pad, top + pad, right - pad, bottom - pad, PAPER)

    # Two offset bars echo the stacked SAID / HERE wordmark without relying on fonts.
    bar_h = max(1, int(unit * .115))
    paint_rect(pixels, width, height, int(width * .30), int(height * .35), int(width * .70), int(height * .35) + bar_h, INK)
    paint_rect(pixels, width, height, int(width * .26), int(height * .55), int(width * .66), int(height * .55) + bar_h, INK)

    # Small location marker accent.
    dot = max(1, int(unit * .055))
    cx, cy = int(width * .72), int(height * .61)
    paint_rect(pixels, width, height, cx - dot, cy - dot, cx + dot, cy + dot, BLUE)
    return pixels


def replace_pngs(folder: Path) -> int:
    if not folder.exists():
        return 0
    count = 0
    for path in folder.glob('*.png'):
        size = png_size(path)
        if not size:
            continue
        width, height = size
        if width <= 0 or height <= 0:
            continue
        write_png(path, width, height, make_icon(width, height))
        count += 1
    return count


def main() -> None:
    count = 0
    count += replace_pngs(ROOT / 'ios/Runner/Assets.xcassets/AppIcon.appiconset')
    count += replace_pngs(ROOT / 'ios/Runner/Assets.xcassets/LaunchImage.imageset')
    for folder in (ROOT / 'android/app/src/main/res').glob('mipmap-*'):
        count += replace_pngs(folder)
    print(f'Replaced {count} generated placeholder PNGs with SaidHere brand assets')


if __name__ == '__main__':
    main()
