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

# 🔴 THE TRUST ANCHOR, PINNED. Without this the whole file was theatre against the one
# attacker who matters here: whoever controls the endpoint can mint their own root, sign
# their own chain, sign a document with any PCR0 they like, echo the nonce and set the
# mirror to match. Every other check below would go green, `--pcr0-only` would print that
# PCR0, and frame 3 would ask the registry about a measurement chosen by the attacker.
# Found by a reviewer on PR #25; the forged-chain case is in test-attest-verify.py and it
# is a REAL forgery — its own CA, its own ES384 signature — not a stub.
#
# What this value is, stated exactly: the SHA-256 of the DER of the root certificate that
# the documents served by our demo box chain to, recorded 12 September 2026. It is NOT a
# value we can prove is AWS's from inside this file. Anyone who does not want to take our
# word for one constant compares it once against AWS's own published root:
#
#   curl -sO https://aws-nitro-enclaves.amazonaws.com/AWS_NitroEnclaves_Root-G1.zip
#   unzip -p AWS_NitroEnclaves_Root-G1.zip > aws-nitro-root
#   openssl x509 -in aws-nitro-root -outform DER | shasum -a 256
#
# After that comparison the pin is theirs rather than ours. Supplying NITRO_ROOT=<file>
# does the same job per-run: the anchor used is then their file, and it is still required
# to match this fingerprint, so a wrong file is caught instead of silently trusted.
NITRO_ROOT_SHA256 = '641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b'


def dec(b, i=0, cose_tag_ok=False):
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
    if mt == 6:
        # 🔴 A TAG IS NOT A DEFECT — AND TAG 18 IS LEGAL IN EXACTLY ONE PLACE. RFC 8152
        # permits a COSE_Sign1 wrapped in tag 18, so `0xd2 0x84 …` encodes exactly the
        # document we read today as `0x84 …`. Before that was handled, both of our
        # verifiers refused a tagged document as unreadable — blaming a valid attestation.
        #
        # 🔴 But the first version of this branch unwrapped tag 18 ANYWHERE, and this same
        # decoder reads `sign1[0]` and `sign1[2]`. So a tagged protected header or a
        # tagged payload would also have unwrapped and then passed the type checks, and we
        # would have accepted a document no COSE implementation would produce — signing
        # over bytes whose framing we had quietly rewritten. Caught in review on the PR
        # that introduced it.
        #
        # `cose_tag_ok` is therefore set by the OUTERMOST call only and never propagates:
        # every recursive call below leaves it false. Nested tags, including a second
        # tag 18, are refused by number, as is any tag we do not implement — silently
        # ignoring semantics is how a parser starts agreeing to things.
        if not (cose_tag_ok and val == 18):
            raise ValueError(
                f'unexpected CBOR tag {val}'
                if not cose_tag_ok
                else f'unexpected CBOR tag {val} (only tag 18 is legal here)'
            )
        return dec(b, i)
    if mt == 7:
        if ai in (20, 21, 22, 23):
            return {20: False, 21: True, 22: None, 23: None}[ai], i
        # Floats are major 7 with ai 25/26/27. Refused on purpose: nothing in an
        # attestation document is a float.
        raise ValueError(f'unsupported simple or float value (ai {ai})')
    raise ValueError(f'unsupported major type {mt}')


def head(mt, n):
    if n < 24:
        return bytes([mt << 5 | n])
    if n < 0x100:
        return bytes([mt << 5 | 24, n])
    if n < 0x10000:
        return bytes([mt << 5 | 25]) + n.to_bytes(2, 'big')
    if n < 0x1_0000_0000:
        return bytes([mt << 5 | 26]) + n.to_bytes(4, 'big')
    # The 8-byte form. Not reachable from the lengths this file encodes, but the
    # falsification harness builds whole CBOR documents with this helper and an attestation
    # timestamp in milliseconds does not fit in four bytes — it raised OverflowError, which
    # is a worse way to find out than a branch.
    return bytes([mt << 5 | 27]) + n.to_bytes(8, 'big')


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

    # 🔴 EXPLICIT CHECKS, NOT `assert`. Two reasons, both from a reviewer on PR #25:
    # `python -O` deletes assert statements outright, which would let a malformed document
    # walk straight into openssl; and this path used to return 1, reporting an unreadable
    # body as a FAILED verification. A document we cannot parse is a could-not-check about
    # the input (exit 2), not a verdict on the enclave. Every field openssl or the later
    # code touches is type- and length-checked here, before anything is handed over.
    def unreadable(why):
        say(f'   could not check: {why}')
        say('   (this is about the document we were handed, not a verdict on the enclave)')
        return None

    checks = {}
    try:
        # The only call in this file that may see a COSE tag: the document envelope.
        sign1, _consumed = dec(raw, 0, cose_tag_ok=True)
    except Exception as err:
        unreadable(f'the body is not CBOR ({type(err).__name__})')
        return 2
    if not (isinstance(sign1, list) and len(sign1) == 4):
        unreadable('not a 4-item COSE_Sign1 array')
        return 2
    if not all(isinstance(sign1[i], (bytes, bytearray)) for i in (0, 2, 3)):
        unreadable('COSE_Sign1 fields 0/2/3 must be byte strings')
        return 2
    try:
        protected, _ = dec(bytes(sign1[0]))
        payload, _ = dec(bytes(sign1[2]))
    except Exception as err:
        # 🔴 THE DECODER'S OWN MESSAGE IS PASSED THROUGH, and that is deliberate rather
        # than sloppy. Elsewhere in this project a library's error is withheld because it
        # quotes the rejected VALUE back (viem prints the scalar it refused). This decoder
        # is ours and its messages carry only structure — a tag number, a major type, an
        # additional-info byte — never a value. Withholding it cost more than it saved:
        # a tagged protected header was reported as "not CBOR", which is false and sends
        # the reader looking for corruption. The bytes were CBOR; the tag was in a place
        # no tag may be.
        unreadable(f'the protected header or payload could not be read: {err}')
        return 2
    if not isinstance(protected, dict) or protected.get(1) != ES384:
        alg = protected.get(1) if isinstance(protected, dict) else type(protected).__name__
        unreadable(f'alg is {alg}, expected ES384 ({ES384})')
        return 2
    if not isinstance(payload, dict):
        unreadable('the payload is not a CBOR map')
        return 2
    pcrs = payload.get('pcrs')
    if not isinstance(pcrs, dict) or not isinstance(pcrs.get(0), (bytes, bytearray)):
        unreadable('pcrs[0] is missing or is not a byte string')
        return 2
    pcr0 = bytes(pcrs[0])
    if len(pcr0) != 48:
        unreadable(f'PCR0 is {len(pcr0)} bytes, expected 48 for SHA-384')
        return 2
    leaf_der = payload.get('certificate')
    if not isinstance(leaf_der, (bytes, bytearray)) or len(leaf_der) == 0:
        unreadable('`certificate` is missing or is not a byte string')
        return 2
    bundle = payload.get('cabundle')
    if not isinstance(bundle, list) or len(bundle) == 0 or not all(
        isinstance(c, (bytes, bytearray)) and len(c) > 0 for c in bundle
    ):
        unreadable('`cabundle` is missing, empty, or is not a list of byte strings')
        return 2
    sig = bytes(sign1[3])
    if len(sig) == 0 or len(sig) % 2 != 0:
        unreadable(f'the signature is {len(sig)} bytes, which cannot split into r and s')
        return 2
    nonce_field = payload.get('nonce')
    if nonce_field is not None and not isinstance(nonce_field, (bytes, bytearray)):
        unreadable('`nonce` is present but is not a byte string')
        return 2
    checks['cose_parsed'] = True

    doc_nonce = bytes(nonce_field or b'').hex()
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
            leaf = der_to_cert(bytes(leaf_der), 'leaf-cert')
            doc_root_der = bytes(bundle[0])
            doc_root = der_to_cert(doc_root_der, 'root-cert')
            with open(j('chain-certs'), 'wb') as out:
                for n, der in enumerate(bundle[1:]):
                    out.write(open(der_to_cert(bytes(der), f'chain{n}'), 'rb').read())

            # The anchor actually used, and its fingerprint — whichever it is. A supplied
            # NITRO_ROOT may be PEM or DER, so openssl converts it back to DER for the
            # comparison instead of us guessing at the encoding.
            supplied = os.environ.get('NITRO_ROOT')
            if supplied:
                to_der = subprocess.run(['openssl', 'x509', '-in', supplied, '-outform', 'DER'],
                                        capture_output=True)
                if to_der.returncode != 0:
                    to_der = subprocess.run(
                        ['openssl', 'x509', '-in', supplied, '-inform', 'DER', '-outform', 'DER'],
                        capture_output=True)
                if to_der.returncode != 0:
                    say(f'   could not check: NITRO_ROOT={supplied} is not a readable certificate')
                    return 2
                anchor, anchor_der, anchored = supplied, to_der.stdout, True
            else:
                anchor, anchor_der, anchored = doc_root, doc_root_der, False

            # 🔴 The check the file was missing. Whatever anchored the chain has to be the
            # certificate we pinned; otherwise "the chain verifies" only says the attacker
            # was consistent with themselves.
            anchor_fp = hashlib.sha256(anchor_der).hexdigest()
            checks['root_pinned'] = (anchor_fp == NITRO_ROOT_SHA256)

            # `-untrusted` with an EMPTY file makes openssl fail on the file rather than on
            # the chain, which would print a red that means "your cabundle had no
            # intermediates" while looking like "this chain is not trusted". Found while
            # building the forged-chain case, whose bundle is a single root.
            cmd = ['openssl', 'verify', '-CAfile', anchor]
            if len(bundle) > 1:
                cmd += ['-untrusted', j('chain-certs')]
            verify = subprocess.run(cmd + [leaf], capture_output=True, text=True)
            checks['chain_anchored' if anchored else 'chain_internal'] = (verify.returncode == 0)
            chain_detail = verify.stdout.strip() or verify.stderr.strip()

            subprocess.run(['openssl', 'x509', '-inform', 'DER', '-pubkey', '-noout', '-out', j('pubkey')],
                           input=bytes(leaf_der), capture_output=True, check=True)
            open(j('sig.der'), 'wb').write(der_ecdsa(sig))
            open(j('ss.bin'), 'wb').write(sig_structure(bytes(sign1[0]), bytes(sign1[2])))
            sigv = subprocess.run(
                ['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey', j('pubkey'),
                 '-sigfile', j('sig.der'), '-rawin', '-digest', 'sha384', '-in', j('ss.bin')],
                capture_output=True, text=True)
            checks['cose_signature'] = (sigv.returncode == 0)
        except subprocess.CalledProcessError as err:
            detail = err.stderr.decode(errors='replace') if isinstance(err.stderr, bytes) else str(err.stderr)
            say(f'   could not check: openssl refused an input ({detail[:120]!r})')
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
    if not checks['root_pinned']:
        say('   🔴 THE ANCHOR IS NOT THE CERTIFICATE WE PINNED, so nothing else on this list')
        say('      means very much: a chain can be perfectly consistent with a root the')
        say('      attacker minted. Expected and actual, in full, because this is the one')
        say('      line worth reading character by character:')
        say(f'      pinned: {NITRO_ROOT_SHA256}')
        say(f'      actual: {anchor_fp}')
    elif anchored:
        say('   the chain is anchored to the certificate YOU supplied via NITRO_ROOT, and')
        say('   that certificate matches the pinned fingerprint. This is the strongest')
        say('   form this check takes without leaving the machine.')
    else:
        say('   the chain is anchored to the root inside the document, and that root matches')
        say('   a fingerprint THIS REPOSITORY SHIPS. That defeats a forged chain — an')
        say('   attacker cannot produce a different certificate with this hash — but the')
        say('   fingerprint itself is still ours until you check it once against AWS:')
        say('')
        say('      curl -sO https://aws-nitro-enclaves.amazonaws.com/AWS_NitroEnclaves_Root-G1.zip')
        say('      unzip -p AWS_NitroEnclaves_Root-G1.zip > aws-nitro-root')
        say('      openssl x509 -in aws-nitro-root -outform DER | shasum -a 256')
        say('')
        say(f'      expect: {NITRO_ROOT_SHA256}')
        say('      Then NITRO_ROOT=aws-nitro-root here, and the line above says chain_anchored.')
    return 0 if all(checks.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
