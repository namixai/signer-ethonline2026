#!/usr/bin/env python3
"""Is the voiceover readable at the pace the footage allows?

Written because "it feels about right" is not a measurement, and a script that cannot be
read at a human pace forces the one thing ETHGlobal forbids outright: speeding up to fit.

A comfortable read is 130-150 words per minute, and lower for a second language. Blocks
over the limit are printed with the words that must go.
"""
import re, sys

LIMIT_WPM = float(sys.argv[2]) if len(sys.argv) > 2 else 145.0


def cues(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        m = re.match(r"\|\s*(\d+):(\d\d)\s*\|([^|]*)\|(.*)\|\s*$", line)
        if m:
            t = int(m.group(1)) * 60 + int(m.group(2))
            say = m.group(4)
            words = len(re.findall(r"[A-Za-z0-9'’\-]+", " ".join(re.findall(r'"([^"]*)"', say))))
            rows.append((t, words, m.group(3).strip()[:34]))
    return rows


rows = cues(sys.argv[1])
over = 0
print(f"{'cue':>6}  {'window':>7}  {'words':>5}  {'wpm':>5}  screen")
for i, (t, w, screen) in enumerate(rows):
    span = (rows[i + 1][0] - t) if i + 1 < len(rows) else 8
    wpm = w / span * 60 if span else 0
    flag = "  🔴 длинно" if wpm > LIMIT_WPM else ""
    over += 1 if wpm > LIMIT_WPM else 0
    print(f"{t//60}:{t%60:02d}  {span:5.0f} с  {w:5}  {wpm:5.0f}{flag}  {screen}")
total_w = sum(w for _, w, _ in rows)
total_s = rows[-1][0] + 8 - rows[0][0]
print(f"\nвсего {total_w} слов на {total_s} с = {total_w/total_s*60:.0f} слов/мин "
      f"(предел {LIMIT_WPM:.0f}); блоков сверх предела: {over}")
sys.exit(1 if over else 0)
