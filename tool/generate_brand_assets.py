#!/usr/bin/env python3
"""Build native app branding from the uploaded The Wall plaque without external dependencies."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'lib/267ABF9F-A613-4DD2-B026-87B6C2B6AEBD.png'
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
DOOR = (203, 190, 166)


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def read_png(path: Path) -> tuple[int, int, bytearray]:
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise RuntimeError(f'{path} is not a PNG file')

    pos = len(PNG_SIGNATURE)
    width = height = bit_depth = color_type = interlace = None
    compressed = bytearray()

    while pos + 12 <= len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        payload = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b'IHDR':
            width, height, bit_depth, color_type, _compression, _filter, interlace = struct.unpack(
                '>IIBBBBB', payload
            )
        elif kind == b'IDAT':
            compressed.extend(payload)
        elif kind == b'IEND':
            break

    if width is None or height is None:
        raise RuntimeError('PNG is missing IHDR')
    if bit_depth != 8 or interlace != 0:
        raise RuntimeError('The Wall artwork must be a non-interlaced 8-bit PNG')

    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color_type)
    if channels is None:
        raise RuntimeError(f'Unsupported PNG color type: {color_type}')

    decoded = zlib.decompress(bytes(compressed))
    stride = width * channels
    expected = height * (stride + 1)
    if len(decoded) != expected:
        raise RuntimeError(f'Unexpected PNG data size: {len(decoded)} != {expected}')

    rows: list[bytearray] = []
    offset = 0
    previous = bytearray(stride)
    for _y in range(height):
        filter_type = decoded[offset]
        offset += 1
        raw = bytearray(decoded[offset:offset + stride])
        offset += stride
        recon = bytearray(stride)

        for i, value in enumerate(raw):
            left = recon[i - channels] if i >= channels else 0
            up = previous[i]
            up_left = previous[i - channels] if i >= channels else 0
            if filter_type == 0:
                result = value
            elif filter_type == 1:
                result = (value + left) & 0xFF
            elif filter_type == 2:
                result = (value + up) & 0xFF
            elif filter_type == 3:
                result = (value + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                result = (value + paeth(left, up, up_left)) & 0xFF
            else:
                raise RuntimeError(f'Unsupported PNG filter type: {filter_type}')
            recon[i] = result

        rows.append(recon)
        previous = recon

    rgba = bytearray(width * height * 4)
    out = 0
    for row in rows:
        for x in range(width):
            i = x * channels
            if color_type == 0:
                gray = row[i]
                values = (gray, gray, gray, 255)
            elif color_type == 2:
                values = (row[i], row[i + 1], row[i + 2], 255)
            elif color_type == 4:
                gray = row[i]
                values = (gray, gray, gray, row[i + 1])
            else:
                values = (row[i], row[i + 1], row[i + 2], row[i + 3])
            rgba[out:out + 4] = bytes(values)
            out += 4

    return width, height, rgba


def chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack('>I', len(data))
        + kind
        + data
        + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def write_png(path: Path, width: int, height: int, pixels: bytearray) -> None:
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        start = y * stride
        raw.extend(pixels[start:start + stride])
    payload = PNG_SIGNATURE
    payload += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    payload += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    payload += chunk(b'IEND', b'')
    path.write_bytes(payload)


def png_size(path: Path) -> tuple[int, int] | None:
    try:
        data = path.read_bytes()
        if data[:8] != PNG_SIGNATURE or data[12:16] != b'IHDR':
            return None
        return struct.unpack('>II', data[16:24])
    except OSError:
        return None


def resize_cover(
    source: bytearray,
    source_width: int,
    source_height: int,
    target_width: int,
    target_height: int,
) -> bytearray:
    target_ratio = target_width / target_height
    source_ratio = source_width / source_height

    if source_ratio > target_ratio:
        crop_height = source_height
        crop_width = int(round(crop_height * target_ratio))
        crop_x = (source_width - crop_width) // 2
        crop_y = 0
    else:
        crop_width = source_width
        crop_height = int(round(crop_width / target_ratio))
        crop_x = 0
        crop_y = (source_height - crop_height) // 2

    result = bytearray(target_width * target_height * 4)
    for y in range(target_height):
        sy = crop_y + min(crop_height - 1, int((y + 0.5) * crop_height / target_height))
        for x in range(target_width):
            sx = crop_x + min(crop_width - 1, int((x + 0.5) * crop_width / target_width))
            source_index = (sy * source_width + sx) * 4
            target_index = (y * target_width + x) * 4
            result[target_index:target_index + 4] = source[source_index:source_index + 4]
    return result


def flatten_alpha(pixels: bytearray) -> bytearray:
    result = bytearray(len(pixels))
    for i in range(0, len(pixels), 4):
        alpha = pixels[i + 3] / 255.0
        inv = 1.0 - alpha
        result[i] = int(round(pixels[i] * alpha + DOOR[0] * inv))
        result[i + 1] = int(round(pixels[i + 1] * alpha + DOOR[1] * inv))
        result[i + 2] = int(round(pixels[i + 2] * alpha + DOOR[2] * inv))
        result[i + 3] = 255
    return result


def replace_pngs(folder: Path, source_width: int, source_height: int, source: bytearray) -> int:
    if not folder.exists():
        return 0
    count = 0
    for path in folder.glob('*.png'):
        size = png_size(path)
        if not size:
            continue
        width, height = size
        pixels = resize_cover(source, source_width, source_height, width, height)
        write_png(path, width, height, flatten_alpha(pixels))
        count += 1
    return count


def main() -> None:
    if not SOURCE.exists():
        raise RuntimeError(f'Missing The Wall plaque artwork: {SOURCE}')

    source_width, source_height, source = read_png(SOURCE)
    count = 0
    count += replace_pngs(
        ROOT / 'ios/Runner/Assets.xcassets/AppIcon.appiconset',
        source_width,
        source_height,
        source,
    )
    count += replace_pngs(
        ROOT / 'ios/Runner/Assets.xcassets/LaunchImage.imageset',
        source_width,
        source_height,
        source,
    )
    for folder in (ROOT / 'android/app/src/main/res').glob('mipmap-*'):
        count += replace_pngs(folder, source_width, source_height, source)

    print(f'Replaced {count} generated placeholder PNGs with The Wall plaque artwork')


if __name__ == '__main__':
    main()
