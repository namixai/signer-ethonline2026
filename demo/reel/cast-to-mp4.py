#!/usr/bin/env python3
"""Render an asciicast v2 recording to an mp4. No screen capture, no hand editing.

Why this exists rather than a screen recording: the storyboard's own rule is that a
recording nobody can reproduce is the wrong artifact. A capture of somebody's desktop
cannot be re-made by a stranger; this can — the input is a cast file in the repository
and the output is deterministic.

🔴 It does NOT change timings. Frames are sampled from the cast's own clock, so the video
lasts exactly as long as the run did. Pacing belongs in the run (see DEMO_PAUSE_MS in
demo.sh), not here: painting timings onto a fast run would be a recording of something
that never happened, and ETHGlobal forbids speeding a video up to fit the limit — the
same principle in the other direction.

A cast may be given as `path:hold`, where hold is seconds to keep the finished screen on
view. That is not a timing change: it is the terminal sitting there after the command
returned, which is what it does. `npm run leverage` prints its answer in about a second
and a viewer needs longer than that to read it.

Usage: cast-to-mp4.py out.mp4 a.cast[:hold] [b.cast[:hold] ...]
"""
import json, os, re, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1280, 720, 12
FONT_PATH = "/System/Library/Fonts/Menlo.ttc"
SYMBOL_FONT = "/System/Library/Fonts/Apple Symbols.ttf"
BG, FG = (13, 17, 23), (201, 209, 217)
# 🔴 THE RESET CODES ARE AS LOAD-BEARING AS THE COLOUR ONES, and leaving them out does not
# look like a bug — it looks like a design. Measured: the walkthrough emits exactly two
# codes, `33` around one word and `39` to put the colour back. `39` was missing here, so
# the amber leaked from that word to the end of the reel and the whole terminal looked
# deliberately retro. Caught by looking at a frame, not by anything failing.
SGR = {
    "0": ("reset", None),      # all attributes off
    "1": ("bold", True),
    "22": ("bold", False),     # normal intensity
    "39": ("fg", FG),          # default foreground — the counterpart of every colour below
    "30": ("fg", (110, 118, 129)), "31": ("fg", (255, 123, 114)), "32": ("fg", (86, 211, 100)),
    "33": ("fg", (210, 168, 66)), "34": ("fg", (121, 192, 255)), "35": ("fg", (210, 168, 255)),
    "36": ("fg", (121, 192, 255)), "37": ("fg", FG),
}
ANSI = re.compile(r"\x1b\[([0-9;]*)m")


def load(path):
    with open(path, encoding="utf-8") as f:
        head = json.loads(f.readline())
        evs = [json.loads(l) for l in f if l.strip()]
    return head, [e for e in evs if len(e) >= 3 and e[1] == "o"]


def spans(text, state):
    """Split text into (string, colour, bold) runs, carrying SGR state across chunks."""
    out, pos = [], 0
    for m in ANSI.finditer(text):
        if m.start() > pos:
            out.append((text[pos:m.start()], state["fg"], state["bold"]))
        for code in (m.group(1) or "0").split(";"):
            kind, val = SGR.get(code, (None, None))
            if kind == "reset":
                state["fg"], state["bold"] = FG, False
            elif kind == "bold":
                state["bold"] = val
            elif kind == "fg":
                state["fg"] = val
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], state["fg"], state["bold"]))
    return out


# 🔴 A MISSING GLYPH IS PIXELS TOO. The obvious check — "did anything draw?" — passes on
# the very failure it looks for, because .notdef is a filled box. Caught by eye after the
# first render came out with tofu where the box-drawing rules should be: Menlo BOLD has no
# U+2500, Menlo Regular does, and every "does the font have it" probe said yes.
# So the check compares against a character guaranteed to be absent: identical bitmap
# means we are looking at the same .notdef box.
_MISSING_CACHE = {}


def glyph_present(font, ch):
    key = (id(font), ch)
    if key not in _MISSING_CACHE:
        def bitmap(c):
            img = Image.new("L", (40, 40), 0)
            ImageDraw.Draw(img).text((8, 8), c, font=font, fill=255)
            return img.tobytes()
        _MISSING_CACHE[key] = bitmap(ch) != bitmap("\uffff")
    return _MISSING_CACHE[key]


# Zero-width by definition; drawn, they become a second box next to the emoji they modify.
INVISIBLE = {"\ufe0f", "\ufe0e", "\u200d", "\u200b"}


def render(casts, out_mp4):
    font = ImageFont.truetype(FONT_PATH, 15)
    bold = ImageFont.truetype(FONT_PATH, 15, index=1)
    symbols = ImageFont.truetype(SYMBOL_FONT, 15) if os.path.exists(SYMBOL_FONT) else font

    def face_for(ch, want_bold):
        """Bold first when asked, then regular, then the symbol face. A character we
        cannot draw anywhere is dropped rather than shown as a box on camera."""
        for f in ([bold] if want_bold else []) + [font, symbols]:
            if glyph_present(f, ch):
                return f
        return None

    cw = font.getlength("M")
    lh = 19
    cols, rows = int((W - 32) // cw), int((H - 24) // lh)

    # One timeline across all casts, each starting where the previous ended.
    timeline, offset, last_hold = [], 0.0, 0.0
    for spec in casts:
        path, _, hold = spec.partition(":")
        head, evs = load(path)
        for t, _, data in evs:
            timeline.append((offset + t, data))
        last_hold = float(hold or 0)
        offset += (evs[-1][0] if evs else 0) + last_hold + 1.2   # hold, then a beat
    # 🔴 The LAST cast's hold has to be added here, not just to `offset`. Nothing follows
    # it, so its hold vanished and the closing frame got the 2s tail alone — measured: the
    # reel came out 209s where the composition called for 229, and the narrator would have
    # had two seconds for the closing line. The parameter was accepted and silently ignored
    # for exactly one cast, which is the position it matters most.
    total = timeline[-1][0] + last_hold + 2.0 if timeline else 0

    tmp = tempfile.mkdtemp(prefix="reel-")
    screen, state, i, n = [[]], {"fg": FG, "bold": False}, 0, 0
    for frame in range(int(total * FPS) + 1):
        now = frame / FPS
        while i < len(timeline) and timeline[i][0] <= now:
            for chunk, colour, is_bold in spans(timeline[i][1], state):
                for ch in chunk:
                    if ch == "\n":
                        screen.append([])
                    elif ch == "\r":
                        pass
                    elif ch in INVISIBLE:
                        pass
                    else:
                        if len(screen[-1]) >= cols:
                            screen.append([])
                        screen[-1].append((ch, colour, is_bold))
            i += 1
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        for y, line in enumerate(screen[-rows:]):
            x = 16
            for ch, colour, is_bold in line:
                face = face_for(ch, is_bold)
                if face is not None:
                    d.text((x, 12 + y * lh), ch, font=face, fill=colour)
                x += cw
        img.save(os.path.join(tmp, f"{frame:06d}.png"))
        n = frame
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
                    "-i", os.path.join(tmp, "%06d.png"), "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "20", out_mp4], check=True)
    return n + 1, total


if __name__ == "__main__":
    frames, secs = render(sys.argv[2:], sys.argv[1])
    print(f"{sys.argv[1]}: {frames} кадров, {secs:.1f} с, {W}x{H}, {FPS} fps")
