#!/usr/bin/env python3
"""测量学生立绘的内容包围盒（alpha > 8）。

为什么需要它：
  课堂画布把立绘按「内容包围盒」裁切后等高绘制。一个角色有五个状态，
  如果每个状态各用各的裁切矩形，切换状态时人物会跳动（举手时头顶抬高，
  裁切框跟着变，脸的位置就漂了）。

  所以按角色取「所有状态的包围盒并集」，所有状态共用同一裁切矩形 ——
  人物在切换时纹丝不动，只有手臂、嘴巴和头在动。

用法：
  python scripts/measure-student-bbox.py
  → 打印可直接粘进 students-art.js 的 CROP / VIEW / RATIO 表

依赖：Pillow（图像扫描）、Inkscape（栅格化）。仅开发期使用，不进运行时。
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SVG_DIR = ROOT / "public" / "assets" / "students" / "svg"
INKSCAPE = r"D:\Tools\Inkscape\inkscape\bin\inkscape.exe"

KEYS = ["geek", "naughty", "drift"]
STATES = ["default", "closed", "raise", "speak-raise", "idle-down"]
ALPHA_THRESHOLD = 8


def viewbox_of(svg_path: Path) -> tuple:
    """从 SVG 头部抠出 viewBox 的宽高。"""
    head = svg_path.read_text(encoding="utf-8")[:800]
    m = re.search(r'viewBox="([\d.\s-]+)"', head)
    if not m:
        raise SystemExit(f"{svg_path.name}: 找不到 viewBox")
    parts = [float(x) for x in m.group(1).split()]
    return int(parts[2]), int(parts[3])


def rasterize(svg_path: Path, vb_w: int, vb_h: int) -> Image.Image:
    """用 Inkscape 把 SVG 栅格化成 RGBA PNG，1:1 对应 viewBox 尺寸。"""
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "out.png"
        cmd = [
            INKSCAPE, str(svg_path),
            "--export-area-page",
            "--export-type=png",
            f"--export-filename={png}",
            f"--export-width={vb_w}",
            f"--export-height={vb_h}",
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        return Image.open(png).convert("RGBA")


def alpha_bbox(img: Image.Image):
    """扫描 alpha > 阈值的像素，返回 (x0, y0, x1, y1)，空图返回 None。"""
    alpha = img.getchannel("A")
    bbox = alpha.point(lambda a: 255 if a > ALPHA_THRESHOLD else 0).getbbox()
    return bbox


def main():
    out = {}
    for key in KEYS:
        vb = None
        per_state = {}
        for state in STATES:
            svg_path = SVG_DIR / f"{key}-{state}.svg"
            if not svg_path.exists():
                raise SystemExit(f"缺少 {svg_path}")
            if vb is None:
                vb = viewbox_of(svg_path)
            img = rasterize(svg_path, vb[0], vb[1])
            if img.size != vb:
                raise SystemExit(f"{svg_path.name}: 栅格尺寸 {img.size} 与 viewBox {vb} 不符")
            box = alpha_bbox(img)
            if box is None:
                raise SystemExit(f"{svg_path.name}: 画面完全透明")
            per_state[state] = box
            print(f"  {key}-{state}: bbox={box}")

        # 并集：三个状态共用同一裁切矩形，切换状态时人物不跳
        x0 = min(b[0] for b in per_state.values())
        y0 = min(b[1] for b in per_state.values())
        x1 = max(b[2] for b in per_state.values())
        y1 = max(b[3] for b in per_state.values())
        w, h = vb
        crop = {
            "x": round(x0 / w, 4),
            "y": round(y0 / h, 4),
            "w": round((x1 - x0) / w, 4),
            "h": round((y1 - y0) / h, 4),
        }
        # 内容宽高比：按 viewBox 真实像素算，不是比例算
        ratio = ((x1 - x0) / (y1 - y0))
        out[key] = {"view": list(vb), "crop": crop, "ratio": round(ratio, 4),
                    "union_px": [x0, y0, x1, y1]}
        print(f"{key}: union={out[key]['union_px']} view={vb} "
              f"crop={crop} ratio={out[key]['ratio']:.4f}\n")

    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.exit(main())
