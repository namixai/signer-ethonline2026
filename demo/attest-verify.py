#!/usr/bin/env python3
"""Read a PCR0 out of the SIGNED attestation document, not out of a field beside it.

Why this file exists, stated plainly because the reason is the whole point of frame 3.

The demo used to take `pcr0_sha384` from the JSON body and hand that to the on-chain
registry. That field is produced by our own gateway. So the frame that claims "a stranger
checks the running code themselves" was, at its one load-bearing step, checking a number
we typed against a registry entry we made — the hardware signature was downloaded, its
LENGTH was printed, and it was never opened. A verifier that never reads the signed bytes
is a decoration.

So this script opens the document. Five named checks, each of which can go red, and none
of which throws:

  cose_parsed      the body decodes as a COSE_Sign1 with an ES384 header
  nonce_echoed     the nonce INSIDE the document is the one we just sent
  chain_internal   leaf <- intermediates <- root, verified by openssl
  cose_signature   ES384 over the COSE Sig_structure verifies under the leaf's key
  mirror_agrees    the JSON `pcr0_sha384` equals the PCR0 inside the document

The PCR0 printed for the registry call comes from the document. `mirror_agrees` is
therefore a cross-check on our own plumbing rather than the source of the answer: if the
two ever differ, the document wins and the check goes red.

WHAT THIS DOES NOT PROVE, because a verifier that overstates itself is worse than none.
`chain_internal` trusts the root certificate carried IN the document, which is
self-consistency, not an anchor. Anchoring needs AWS's published root:

    curl -sO https://aws-nitro-enclaves.amazonaws.com/AWS_NitroEnclaves_Root-G1.zip
    unzip -p AWS_NitroEnclaves_Root-G1.zip > aws-nitro-root   # one certificate inside
    NITRO_ROOT=aws-nitro-root ./attest-verify.py --nonce <nonce> < body.json

With NITRO_ROOT set, the chain is verified against that file and the result is reported as
`chain_anchored`. Without it, the root's own SHA-256 is printed so the comparison is one
line of eyeballing rather than an act of faith. We do not ship a copy of AWS's root: a
fingerprint you got from us anchors nothing to AWS.

Usage:
    attest-verify.py --nonce <hex>        # JSON body on stdin
    attest-verify.py --nonce <hex> --pcr0-only   # print only the document's PCR0
Exit codes: 0 all checks passed, 1 a check went red, 2 could not check (no openssl, bad
input) — a could-not-check is never reported as a failure of the enclave.
"""
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

ES384 = -35


def dec(b, i=0):
    """Minimal CBOR reader: enough for an NSM attestation document, nothing more."""
    mt, ai = b[i] >> 5, b[i] & 0x1F
    i += 1
    if ai < 24:
        val = ai
    elif ai == 24:
        val, i = b[i], i + 1
    elif ai == 25:
        val, i = int.from_bytes(b[i:i + 2], 'big'), i + 2
    elif ai == 26:
        val, i = int.from_bytes(b[i:i + 4], 'big'), i + 4
    elif ai == 27:
        val, i = int.from_bytes(b[i:i + 8], 'big'), i + 8
    elif ai == 31:
        val = None                                    # indefinite length
    else:
        raise ValueError(f'unsupported additional info {ai}')
    if mt == 0:
        return val, i
    if mt == 1:
        return -1 - val, i
    if mt in (2, 3):
        if val is None:
            parts = []
            while b[i] != 0xFF:
                v, i = dec(b, i)
                parts.append(v)
            return (b''.join(parts) if mt == 2 else ''.join(parts)), i + 1
        raw, i = b[i:i + val], i + val
        return (raw if mt == 2 else raw.decode('utf-8')), i
    if mt == 4:
        out = []
        if val is None:
            while b[i] != 0xFF:
                v, i = dec(b, i)
                out.append(v)
            return out, i + 1
        for _ in range(val):
            v, i = dec(b, i)
            out.append(v)
        return out, i
    if mt == 5:
        out = {}
        if val is None:
            while b[i] != 0xFF:
                k, i = dec(b, i)
                v, i = dec(b, i)
                out[k] = v
            return out, i + 1
        for _ in range(val):
            k, i = dec(b, i)
            v, i = dec(b, i)
            out[k] = v
        return out, i
    if mt == 7:
        return {20: False, 21: True, 22: None, 23: None}.get(ai, val), i
    raise ValueError(f'unsupported major type {mt}')


def head(mt, n):
    if n < 24:
        return bytes([mt << 5 | n])
    if n < 0x100:
        return bytes([mt << 5 | 24, n])
    if n < 0x10000:
        return bytes([mt << 5 | 25]) + n.to_bytes(2, 'big')
    return bytes([mt << 5 | 26]) + n.to_bytes(4, 'big')


def sig_structure(protected, payload):
    """COSE_Sign1 Sig_structure: ["Signature1", protected, external_aad, payload]."""
    bstr = lambda x: head(2, len(x)) + x
    label = "Signature1".encode()
    return head(4, 4) + head(3, len(label)) + label + bstr(protected) + bstr(b'') + bstr(payload)


def der_ecdsa(raw):
    """Raw r||s to the DER SEQUENCE openssl expects."""
    def integer(x):
        v = x.lstrip(b'\x00') or b'\x00'
        if v[0] & 0x80:
            v = b'\x00' + v
        return b'\x02' + bytes([len(v)]) + v
    half = len(raw) // 2
    body = integer(raw[:half]) + integer(raw[half:])
    return b'\x30' + bytes([len(body)]) + body


def main():
    args = sys.argv[1:]
    want_nonce = None
    if '--nonce' in args:
        want_nonce = args[args.index('--nonce') + 1].lower().removeprefix('0x')
    pcr0_only = '--pcr0-only' in args
    say = (lambda *a: None) if pcr0_only else (lambda *a: print(*a, file=sys.stderr))

    if not shutil.which('openssl'):
        say('   could not check: openssl is not on PATH (this is a could-not-check, not a false)')
        return 2
    try:
        body = json.load(sys.stdin)
        raw = base64.b64decode(body['attestation_doc_b64'], validate=True)
    except Exception as err:
        say(f'   could not check: the response is not a readable attestation body ({type(err).__name__})')
        return 2

    checks = {}
    try:
        sign1, consumed = dec(raw)
        assert isinstance(sign1, list) and len(sign1) == 4, 'not a 4-item COSE_Sign1'
        protected, _ = dec(sign1[0])
        assert protected.get(1) == ES384, f'alg is {protected.get(1)}, expected ES384 ({ES384})'
        payload, _ = dec(sign1[2])
        pcr0 = payload['pcrs'][0]
        assert len(pcr0) == 48, f'PCR0 is {len(pcr0)} bytes, expected 48'
        checks['cose_parsed'] = True
    except Exception as err:
        say(f'   🔴 cose_parsed FAILED: {err}')
        return 1

    doc_nonce = (payload.get('nonce') or b'').hex()
    checks['nonce_echoed'] = (want_nonce is not None and doc_nonce == want_nonce)

    with tempfile.TemporaryDirectory() as tmp:
        j = lambda name: os.path.join(tmp, name)
        # No name here ends in .pem: the hygiene gate greps this repository for *.pem,
        # and teaching a gate to stay quiet is a worse trade than renaming a temp file.
        def der_to_cert(der, name):
            subprocess.run(['openssl', 'x509', '-inform', 'DER', '-out', j(name)],
                           input=der, capture_output=True, check=True)
            return j(name)
        try:
            bundle = payload['cabundle']
            leaf = der_to_cert(payload['certificate'], 'leaf-cert')
            doc_root = der_to_cert(bundle[0], 'root-cert')
            with open(j('chain-certs'), 'wb') as out:
                for n, der in enumerate(bundle[1:]):
                    out.write(open(der_to_cert(der, f'chain{n}'), 'rb').read())
            anchor = os.environ.get('NITRO_ROOT') or doc_root
            anchored = bool(os.environ.get('NITRO_ROOT'))
            verify = subprocess.run(
                ['openssl', 'verify', '-CAfile', anchor, '-untrusted', j('chain-certs'), leaf],
                capture_output=True, text=True)
            checks['chain_anchored' if anchored else 'chain_internal'] = (verify.returncode == 0)
            chain_detail = verify.stdout.strip() or verify.stderr.strip()

            subprocess.run(['openssl', 'x509', '-inform', 'DER', '-pubkey', '-noout', '-out', j('pubkey')],
                           input=payload['certificate'], capture_output=True, check=True)
            open(j('sig.der'), 'wb').write(der_ecdsa(sign1[3]))
            open(j('ss.bin'), 'wb').write(sig_structure(sign1[0], sign1[2]))
            sigv = subprocess.run(
                ['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey', j('pubkey'),
                 '-sigfile', j('sig.der'), '-rawin', '-digest', 'sha384', '-in', j('ss.bin')],
                capture_output=True, text=True)
            checks['cose_signature'] = (sigv.returncode == 0)
        except subprocess.CalledProcessError as err:
            say(f'   could not check: openssl refused an input ({err.stderr[:120]!r})')
            return 2

    mirror = (body.get('pcr0_sha384') or '').lower()
    checks['mirror_agrees'] = (mirror == pcr0.hex())

    if pcr0_only:
        # 🔴 Nothing is printed unless every check passed. A caller in this mode feeds the
        # value straight to the registry, and a PCR0 lifted out of a document whose
        # signature does not verify would come back `true` for the wrong reason — the
        # exact failure this file exists to remove. An empty stdout means "could not
        # check"; the caller must treat it as that and not as an answer.
        if not all(checks.values()):
            for name, ok in checks.items():
                if not ok:
                    print(f'   🔴 {name}', file=sys.stderr)
            return 1
        print(pcr0.hex())
        return 0

    say(f'   module_id          : {payload.get("module_id")}')
    say(f'   digest             : {payload.get("digest")}   timestamp: {payload.get("timestamp")}')
    say(f'   PCR0 (from the SIGNED document): {pcr0.hex()}')
    say(f'   nonce inside the document      : {doc_nonce or "(absent)"}')
    say('')
    for name, ok in checks.items():
        say(f'   {"ok  " if ok else "🔴 "} {name}')
    if not checks['nonce_echoed']:
        say(f'        the document names {doc_nonce or "no nonce"}; we asked for {want_nonce or "nothing"}')
    if 'chain_internal' in checks and not checks['chain_internal']:
        say(f'        {chain_detail}')
    if not checks['mirror_agrees']:
        say(f'        the JSON field says {mirror or "(absent)"} — the document wins, and this is why we compare')
    say('')
    if 'chain_internal' in checks:
        root_der = payload['cabundle'][0]
        root_fp = subprocess.run(['openssl', 'x509', '-inform', 'DER', '-noout',
                                  '-fingerprint', '-sha256'],
                                 input=root_der, capture_output=True)
        say('   ⚠️ the root above came from the same document, so the chain is self-consistent,')
        say('      NOT anchored. The one value to get from AWS rather than from us:')
        say(f'      {root_fp.stdout.decode().strip() or "sha256 unavailable"}')
        say(f'      sha256(root DER) = {hashlib.sha256(root_der).hexdigest()}')
        say('      AWS publishes it at aws-nitro-enclaves.amazonaws.com/AWS_NitroEnclaves_Root-G1.zip')
        say('      Set NITRO_ROOT=<that file> and this line becomes chain_anchored.')
    return 0 if all(checks.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
