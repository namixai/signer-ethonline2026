#!/usr/bin/env python3
"""Record a command's terminal output as asciicast v2.

A pty, not a pipe: the demo colours its output and checks it is on a terminal, and a
recording made through a pipe would be a recording of a different program's behaviour.

Usage: record-cast.py out.cast -- command [args...]
"""
import json, os, pty, select, sys, time

COLS, ROWS = int(os.environ.get("CAST_COLS", 100)), int(os.environ.get("CAST_ROWS", 34))


def record(out_path, argv):
    events, start = [], time.time()
    pid, fd = pty.fork()
    if pid == 0:                                  # child
        os.environ["COLUMNS"], os.environ["LINES"] = str(COLS), str(ROWS)
        os.environ["TERM"] = "xterm-256color"
        os.execvp(argv[0], argv)
    import fcntl, struct, termios
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    while True:
        try:
            r, _, _ = select.select([fd], [], [], 0.2)
        except (OSError, ValueError):
            break
        if fd in r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            events.append([round(time.time() - start, 6), "o", data.decode("utf-8", "replace")])
        pid_done, status = os.waitpid(pid, os.WNOHANG)
        if pid_done and not (fd in r):
            break
    try:
        os.close(fd)
    except OSError:
        pass
    header = {"version": 2, "width": COLS, "height": ROWS,
              "timestamp": int(start), "env": {"SHELL": "/bin/bash", "TERM": "xterm-256color"}}
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(header) + "\n")
        for e in events:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    return len(events), events[-1][0] if events else 0.0


if __name__ == "__main__":
    sep = sys.argv.index("--")
    n, dur = record(sys.argv[1], sys.argv[sep + 1:])
    print(f"{sys.argv[1]}: {n} событий, {dur:.1f} с")
