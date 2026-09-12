#!/usr/bin/env python3
"""Falsification harness for attest-verify.py. No network, no dependencies.

    python3 demo/test-attest-verify.py

Each case MUTATES a real attestation document and demands that a named check goes red.
Two rules this file obeys, both learned the hard way in this repository:

  * A mutation is asserted to have applied before its result is judged. A falsification
    that silently failed to apply prints green and proves nothing.
  * The fixture is a PRODUCTION EXTRACT, taken from the live endpoint on 12 September,
    not a hand-written document. A document we assembled ourselves would verify against
    our own assumptions and tell us nothing about the real one.

WHAT IS DELIBERATELY NOT ASSERTED: `chain_internal` on the fixture. Nitro leaf
certificates are short-lived, so `openssl verify` on a stored document starts failing on
its own schedule for a reason that has nothing to do with this code. Asserting it would
buy a test that goes red on a calendar. The harness asserts the check RAN, and the live
run in frame 3 is where its verdict matters.
"""
import base64
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
VERIFY = HERE / 'attest-verify.py'
FIXTURE = HERE / 'fixtures' / 'attestation-live.json'
META = HERE / 'fixtures' / 'attestation-live.meta.json'

sys.path.insert(0, str(HERE))
import importlib.util
spec = importlib.util.spec_from_file_location('av', VERIFY)
av = importlib.util.module_from_spec(spec)
spec.loader.exec_module(av)

body = json.loads(FIXTURE.read_text())
meta = json.loads(META.read_text())
NONCE = meta['nonce']

failures = []


def run(payload, nonce=NONCE, env=None):
    proc = subprocess.run([sys.executable, str(VERIFY), '--nonce', nonce],
                          input=json.dumps(payload), capture_output=True, text=True, env=env)
    states = {}
    for line in proc.stderr.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] in ('ok', '🔴'):
            states[parts[1]] = (parts[0] == 'ok')
    return proc.returncode, states


def case(name, want_red, payload, nonce=NONCE):
    code, states = run(payload, nonce)
    missing = [c for c in want_red if c not in states]
    still_green = [c for c in want_red if states.get(c) is True]
    if missing:
        failures.append(f'{name}: the check never ran at all: {missing} (states seen: {sorted(states)})')
    elif still_green:
        failures.append(f'{name}: expected red, got ok: {still_green}')
    else:
        print(f'  ok   {name} -> red: {", ".join(want_red)}  (exit {code})')


def rebuilt(payload_bytes):
    sign1, _ = av.dec(base64.b64decode(body['attestation_doc_b64']))
    bstr = lambda x: av.head(2, len(x)) + x
    raw = av.head(4, 4) + bstr(sign1[0]) + b'\xa0' + bstr(payload_bytes) + bstr(sign1[3])
    out = dict(body)
    out['attestation_doc_b64'] = base64.b64encode(raw).decode()
    return out


# ── 0. the honest fixture: PCR0 comes out of the document, and the chain check ran ──
code, states = run(body)
if code == 2:
    # The verifier could not run here — no openssl, or one too old for
    # `pkeyutl -rawin -digest`. That is a could-not-check about this machine, not a defect
    # in the code under test, and reporting it as a failure would teach a reader to
    # distrust a red that means nothing.
    print('  could not check on this machine: the verifier returned 2 on an honest fixture.')
    print('  Needs openssl with `pkeyutl -rawin` (3.0+). Nothing below was judged.')
    sys.exit(2)
pcr0_line = [l for l in subprocess.run(
    [sys.executable, str(VERIFY), '--nonce', NONCE], input=json.dumps(body),
    capture_output=True, text=True).stderr.splitlines() if 'PCR0 (from the SIGNED' in l]
if not pcr0_line or meta['pcr0'] not in pcr0_line[0]:
    failures.append(f'honest fixture: the document PCR0 was not printed as {meta["pcr0"][:16]}…')
elif states.get('cose_parsed') is not True or states.get('cose_signature') is not True:
    failures.append(f'honest fixture: a signature check that must pass did not: {states}')
elif not ({'chain_internal', 'chain_anchored'} & set(states)):
    failures.append(f'honest fixture: no chain check ran at all: {sorted(states)}')
else:
    print(f'  ok   honest fixture -> PCR0 from the document, signature verifies '
          f'(chain check present, verdict not asserted; exit {code})')

# ── 1. one bit of PCR0 inside the signed document ──
sign1, _ = av.dec(base64.b64decode(body['attestation_doc_b64']))
payload_bstr = sign1[2]
payload, _ = av.dec(payload_bstr)
pcr0 = payload['pcrs'][0]
at = payload_bstr.find(pcr0)
assert at != -1, 'MUTATION DID NOT APPLY: PCR0 not found in the payload bytes'
flipped = bytearray(payload_bstr)
flipped[at] ^= 0x01
assert bytes(flipped) != payload_bstr, 'MUTATION DID NOT APPLY: payload unchanged'
tampered = rebuilt(bytes(flipped))
check, _ = av.dec(base64.b64decode(tampered['attestation_doc_b64']))
p2, _ = av.dec(check[2])
assert p2['pcrs'][0] != pcr0, 'MUTATION DID NOT APPLY: PCR0 survived the flip'
case('one flipped bit in PCR0', ['cose_signature', 'mirror_agrees'], tampered)

# ── 2. a nonce we never sent ──
assert NONCE != '00' * 16
case('a nonce we never sent', ['nonce_echoed'], body, nonce='00' * 16)

# ── 3. only the JSON mirror field is moved ──
moved = dict(body)
moved['pcr0_sha384'] = '00' + body['pcr0_sha384'][2:]
assert moved['pcr0_sha384'] != body['pcr0_sha384'], 'MUTATION DID NOT APPLY: mirror unchanged'
case('only the JSON mirror moved', ['mirror_agrees'], moved)

# ── 4. an unreadable body is a could-not-check, never a failure ──
proc = subprocess.run([sys.executable, str(VERIFY), '--nonce', NONCE],
                      input='{"nope":1}', capture_output=True, text=True)
if proc.returncode != 2:
    failures.append(f'unreadable body: expected exit 2 (could not check), got {proc.returncode}')
else:
    print('  ok   an unreadable body -> exit 2, could not check (not a false)')

# ── 5. --pcr0-only must stay silent when anything is red ──
out = subprocess.run([sys.executable, str(VERIFY), '--nonce', NONCE, '--pcr0-only'],
                     input=json.dumps(tampered), capture_output=True, text=True)
if out.stdout.strip():
    failures.append('--pcr0-only printed a PCR0 for a document whose signature failed')
else:
    print('  ok   --pcr0-only prints nothing for a tampered document (exit %d)' % out.returncode)

print()
if failures:
    for f in failures:
        print(f'  🔴 {f}')
    print(f'\n{len(failures)} falsification(s) did not bite.')
    sys.exit(1)
print('every falsification bit: each named check can go red.')
