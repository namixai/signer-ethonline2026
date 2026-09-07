#!/usr/bin/env python3
"""Render a gateway response for the camera: print an ALLOW-list, hide the rest.

Why this file exists, stated plainly because the reason is the interesting part.

The demo used to print every field of a `/sign` response except four names it
tried to hide (`signature`, `r`, `s`, `sig`). That is a deny-list, and a deny-list
is a bet that we remembered every secret. We had not: `/sign` answers with a
`headers` map carrying the venue credential — `X-MBX-APIKEY`, `KC-API-SIGN`, and
on OKX the passphrase as well — because in the default mode the client is the one
who submits the order and cannot do it without them. The gateway treats those
strings as secret enough to wipe from memory on drop; the demo printed them to a
screen we were about to film.

The same deny-list also failed on the one field it did name. `signature` on this
route is an object (`{r, s, v}`), and the guard began with `isinstance(v, str)`,
so the object never matched and printed in full. A filter that misses in both
directions while looking careful is worse than no filter: it buys confidence it
does not earn.

So the rule is inverted here, and it is inverted for a reason that outlives this
bug: **secrets outnumber the names we managed to think of, and the next field the
gateway adds will arrive without an announcement.** An allow-list is wrong in the
safe direction — a new field is invisible until someone decides it is safe, and
deciding that is a five-second edit with a reviewer.

Two more rules, both learned from the same failure:

  * The decision is made on the KEY, before the value's type is looked at. Type
    was exactly what the old filter got wrong.
  * An allowed key still only prints a SCALAR. If an allowed key ever carries a
    map or a list, it is summarised, not dumped — because a secret one level down
    is still a secret, and `headers` is precisely that shape.

Usage:
    redact.py            # JSON on stdin, rendered lines on stdout
    redact.py --raw      # print the body unchanged (for the pre-shoot check to
                         # prove its scanner can actually see a leak)
"""
import json
import sys

# Fields worth having ON CAMERA: they are what the frames are about — which layer
# decided, why, and what the venue said. None of them is a credential, and every
# one of them is checkable by the viewer.
SHOW = {
    "venue",
    "kind",
    "ok",
    "denied",
    "reason_code",
    "rule_class",
    "decided_by",
    "detail",
    "error",
    "http_status",
    "outcome",
    "submitted",
    "env",
    "symbol",
    "side",
    "size",
    "limit_px",
    "reduce_only",
}

SCALARS = (str, int, float, bool, type(None))


def render(doc):
    """[(key, text)] for the whole document. Never returns a hidden value."""
    if not isinstance(doc, dict):
        return [("(body)", f"<hidden: {type(doc).__name__}, not an object>")]
    out = []
    for k, v in doc.items():
        if k not in SHOW:
            # The default, and the whole point of the file.
            out.append((k, f"<hidden: {type(v).__name__}>"))
        elif isinstance(v, SCALARS):
            out.append((k, str(v)))
        else:
            # Allowed name, structured value: say how big it is, show nothing.
            n = len(v) if hasattr(v, "__len__") else "?"
            out.append((k, f"<hidden: {type(v).__name__} of {n}>"))
    return out


def main():
    raw = sys.stdin.read()
    if "--raw" in sys.argv[1:]:
        sys.stdout.write(raw)
        return 0
    try:
        doc = json.loads(raw)
    except Exception:
        # A body we cannot parse is a body we cannot redact. Say so; never fall
        # back to printing it, which is what a "just show it" branch would do.
        print("   (body is not JSON — not printed, because an unparsed body cannot be redacted)")
        return 0
    for k, text in render(doc):
        print(f"   {k}: {text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
