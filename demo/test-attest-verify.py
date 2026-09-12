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

def must(condition, why):
    """A guard that survives `python -O`.

    Every `MUTATION DID NOT APPLY` check below is one of these. As `assert` they vanished
    under `-O`, and a harness whose mutation-guards are gone prints green while testing
    nothing — the precise failure this file exists to prevent, one level up.
    """
    if not condition:
        print(f'  🔴 {why}')
        sys.exit(1)


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

# ── 0b. 🔴 A LEGAL RE-PACKING IS NOT A DEFECT: COSE_Sign1 inside CBOR tag 18. ──
#
# RFC 8152 permits it, our gateway does not send it, and before the tag branch existed
# both of our verifiers refused such a document as unreadable — calling a valid
# attestation broken and blaming its producer. Nothing broke because nothing sent one.
raw_doc = base64.b64decode(body['attestation_doc_b64'])
must(raw_doc[0] == 0x84, 'MUTATION DID NOT APPLY: the fixture is not a bare 4-item array')
tagged = dict(body)
tagged['attestation_doc_b64'] = base64.b64encode(b'\xd2' + raw_doc).decode()
must(base64.b64decode(tagged['attestation_doc_b64'])[0] == 0xD2,
     'MUTATION DID NOT APPLY: the tag byte did not get prepended')
_, plain_states = run(body)
tag_code, tag_states = run(tagged)
if tag_states.get('cose_parsed') is not True:
    failures.append('tag 18: a legally tagged document was refused as unreadable')
elif tag_states != plain_states:
    failures.append(f'tag 18: the verdict changed with the tag: {plain_states} vs {tag_states}')
else:
    print('  ok   a COSE_Sign1 in tag 18 reads identically to the same bytes untagged')

# And a tag we do not implement is refused rather than swallowed.
other = dict(body)
other['attestation_doc_b64'] = base64.b64encode(b'\xd8\x3d' + raw_doc).decode()
proc_other = subprocess.run([sys.executable, str(VERIFY), '--nonce', NONCE],
                            input=json.dumps(other), capture_output=True, text=True)
if proc_other.returncode != 2:
    failures.append(f'an unimplemented CBOR tag should be could-not-check (2), got {proc_other.returncode}')
else:
    print('  ok   an unimplemented CBOR tag is refused, not swallowed (exit 2)')

# ── 1. one bit of PCR0 inside the signed document ──
sign1, _ = av.dec(base64.b64decode(body['attestation_doc_b64']))
payload_bstr = sign1[2]
payload, _ = av.dec(payload_bstr)
pcr0 = payload['pcrs'][0]
at = payload_bstr.find(pcr0)
must(at != -1, 'MUTATION DID NOT APPLY: PCR0 not found in the payload bytes')
flipped = bytearray(payload_bstr)
flipped[at] ^= 0x01
must(bytes(flipped) != payload_bstr, 'MUTATION DID NOT APPLY: payload unchanged')
tampered = rebuilt(bytes(flipped))
check, _ = av.dec(base64.b64decode(tampered['attestation_doc_b64']))
p2, _ = av.dec(check[2])
must(p2['pcrs'][0] != pcr0, 'MUTATION DID NOT APPLY: PCR0 survived the flip')
case('one flipped bit in PCR0', ['cose_signature', 'mirror_agrees'], tampered)

# ── 2. a nonce we never sent ──
must(NONCE != '00' * 16, 'MUTATION DID NOT APPLY: the real nonce IS all zeros')
case('a nonce we never sent', ['nonce_echoed'], body, nonce='00' * 16)

# ── 3. only the JSON mirror field is moved ──
moved = dict(body)
moved['pcr0_sha384'] = '00' + body['pcr0_sha384'][2:]
must(moved['pcr0_sha384'] != body['pcr0_sha384'], 'MUTATION DID NOT APPLY: mirror unchanged')
case('only the JSON mirror moved', ['mirror_agrees'], moved)

# ── 3b. 🔴 A REAL FORGED CHAIN. This is the case the pinned root exists for. ──
#
# The attacker here controls the endpoint. They mint their own CA with AWS's own subject
# name, sign an intermediate and a leaf under it, build a complete NSM-shaped document
# that CLAIMS THE REAL REGISTERED PCR0, echo the nonce we asked for, set the mirror field
# to match, and sign the COSE Sig_structure properly with their leaf key. Everything is
# genuine except whose key it is.
#
# Before the pin, every check went green and `--pcr0-only` handed that PCR0 to the
# registry — which would answer `true`, because the measurement is really registered. The
# frame would have shown a stranger's document passing as ours. Five of the six checks
# still pass; `root_pinned` is the one that bites.
#
# The forgery is built here rather than committed: no key material in the repository, and
# a fresh chain each run.
def forge(tmp, pcr0, nonce, timestamp):
    def run(*args, **kw):
        return subprocess.run(['openssl', *args], capture_output=True, check=True, **kw).stdout
    k = lambda n: str(pathlib.Path(tmp) / n)
    for name in ('rootkey', 'interkey', 'leafkey'):
        run('ecparam', '-name', 'secp384r1', '-genkey', '-noout', '-out', k(name))
    run('req', '-new', '-x509', '-key', k('rootkey'), '-sha384', '-days', '365',
        '-out', k('rootcert'), '-subj', '/C=US/O=Amazon/OU=AWS/CN=aws.nitro-enclaves')
    pathlib.Path(k('ext')).write_text(
        'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyCertSign\n')
    run('req', '-new', '-key', k('interkey'), '-sha384', '-out', k('intercsr'),
        '-subj', '/C=US/O=Amazon/OU=AWS/CN=forged.us-east-1.aws.nitro-enclaves')
    run('x509', '-req', '-in', k('intercsr'), '-CA', k('rootcert'), '-CAkey', k('rootkey'),
        '-sha384', '-days', '365', '-extfile', k('ext'), '-out', k('intercert'))
    run('req', '-new', '-key', k('leafkey'), '-sha384', '-out', k('leafcsr'),
        '-subj', '/C=US/O=Amazon/OU=AWS/CN=i-forged-enc0000.us-east-1.aws')
    run('x509', '-req', '-in', k('leafcsr'), '-CA', k('intercert'), '-CAkey', k('interkey'),
        '-sha384', '-days', '365', '-out', k('leafcert'))
    der = lambda n: run('x509', '-in', k(n), '-outform', 'DER')

    def enc(o):
        if isinstance(o, bool):
            return bytes([0xF5 if o else 0xF4])
        if o is None:
            return b'\xF6'
        if isinstance(o, int):
            return av.head(0, o) if o >= 0 else av.head(1, -1 - o)
        if isinstance(o, (bytes, bytearray)):
            return av.head(2, len(o)) + bytes(o)
        if isinstance(o, str):
            return av.head(3, len(o.encode())) + o.encode()
        if isinstance(o, list):
            return av.head(4, len(o)) + b''.join(enc(x) for x in o)
        if isinstance(o, dict):
            return av.head(5, len(o)) + b''.join(enc(a) + enc(b) for a, b in o.items())
        raise TypeError(type(o))

    payload = {
        'module_id': 'i-forged-enc0000',
        'digest': 'SHA384',
        'timestamp': timestamp,
        'pcrs': {i: (pcr0 if i == 0 else bytes(48)) for i in range(16)},
        'certificate': der('leafcert'),
        'cabundle': [der('rootcert'), der('intercert')],
        'public_key': None,
        'user_data': None,
        'nonce': nonce,
    }
    payload_bstr, prot = enc(payload), enc({1: av.ES384})
    pathlib.Path(k('ss')).write_bytes(av.sig_structure(prot, payload_bstr))
    der_sig = run('dgst', '-sha384', '-sign', k('leafkey'), k('ss'))
    i, parts = (2 if der_sig[1] < 0x80 else 2 + (der_sig[1] & 0x7F)), []
    for _ in range(2):
        ln = der_sig[i + 1]
        parts.append(der_sig[i + 2:i + 2 + ln].lstrip(b'\x00').rjust(48, b'\x00'))
        i += 2 + ln
    raw_sig = b''.join(parts)
    cose = (av.head(4, 4) + av.head(2, len(prot)) + prot + b'\xa0'
            + av.head(2, len(payload_bstr)) + payload_bstr + av.head(2, len(raw_sig)) + raw_sig)
    return {'attestation_doc_b64': base64.b64encode(cose).decode(),
            'pcr0_sha384': pcr0.hex(), 'timestamp_ms': timestamp}


import tempfile
with tempfile.TemporaryDirectory() as tmp:
    real_pcr0 = bytes.fromhex(meta['pcr0'])
    forged = forge(tmp, real_pcr0, bytes.fromhex(NONCE), 1789204297092)
    code, states = run(forged)
    green = [n for n, ok in states.items() if ok]
    if states.get('root_pinned') is not False:
        failures.append('forged chain: root_pinned did not go red — the pin is not doing its job')
    elif not all(states.get(c) for c in ('cose_parsed', 'nonce_echoed', 'cose_signature',
                                         'mirror_agrees', 'chain_internal')):
        # If the forgery fails for some OTHER reason, this case stops testing the pin and
        # starts testing the forgery. That has to be loud, not convenient.
        failures.append(f'forged chain: it failed somewhere else too, so the pin was not what '
                        f'caught it: {states}')
    else:
        out = subprocess.run([sys.executable, str(VERIFY), '--nonce', NONCE, '--pcr0-only'],
                             input=json.dumps(forged), capture_output=True, text=True)
        if out.stdout.strip():
            failures.append('forged chain: --pcr0-only printed the attacker\'s PCR0')
        else:
            print(f'  ok   a REAL forged chain claiming the registered PCR0 -> red: root_pinned '
                  f'(everything else green: {", ".join(sorted(green))}; exit {code}), '
                  f'and --pcr0-only stayed silent')

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
