"""Path A for the position-NFT permits — Uniswap v3 and v4. Standard library only.

These are the *other* signatures in the Uniswap swap path. Permit2 moves ERC-20s; these
two move ERC-721 positions, and the UniversalRouter can forward one of them (v3) as a
command inside an ordinary swap transaction.

🔴 The reason this file exists separately from `permit2_ref.py`, and the single most
important fact in it:

    v3 and v4 use the SAME struct type hash — 0x49ecf333… for
    `Permit(address spender,uint256 tokenId,uint256 nonce,uint256 deadline)` —
    and DIFFERENT domains.

      v3 NonfungiblePositionManager: EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
      v4 PositionManager:            EIP712Domain(string name,uint256 chainId,address verifyingContract)

An implementer who checks "the type hash matches" is reassured by the check and still
produces a signature the other contract rejects. There is no error message that tells you
this; the recovered address simply is not the owner.

Sources read (pinned):
  Uniswap/v3-periphery @ 0682387198a24c7cd63566a2c58398533860a5d1
    contracts/base/ERC721Permit.sol          — 4-field domain, PERMIT_TYPEHASH, ecrecover/ERC-1271
    contracts/NonfungiblePositionManager.sol — ERC721Permit('Uniswap V3 Positions NFT-V1', 'UNI-V3-POS', '1')
                                               _getAndIncrementNonce -> _positions[tokenId].nonce++
  Uniswap/v4-periphery @ 07336f2144f522874e2c3c85e04d1d3f8d5fa471
    src/base/EIP712_v4.sol         — 3-field domain, name = the ERC-721 name, cached per chainid
    src/base/ERC721Permit_v4.sol   — permit() and permitForAll(), signature via Permit2's
                                     SignatureVerification (so ERC-1271 and EIP-2098 apply)
    src/libraries/ERC721PermitHash.sol — both type hashes
    src/base/UnorderedNonce.sol    — nonce bitmap keyed by OWNER, not by tokenId
"""

from keccak_min import keccak256

# --- type strings, verbatim from the sources -----------------------------------

TS_PERMIT = "Permit(address spender,uint256 tokenId,uint256 nonce,uint256 deadline)"
TS_PERMIT_FOR_ALL = "PermitForAll(address operator,bool approved,uint256 nonce,uint256 deadline)"

TS_DOMAIN_4 = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
TS_DOMAIN_3 = "EIP712Domain(string name,uint256 chainId,address verifyingContract)"


def type_hash(s: str) -> bytes:
    return keccak256(s.encode())


def enc_uint(value) -> bytes:
    """Decimal strings, for the same reason as in permit2_ref: a JSON number is a double
    on the JavaScript side and large values come back off by one."""
    if isinstance(value, str):
        if not value.isdigit():
            raise ValueError(f"integer must be a decimal string, got {value!r}")
        value = int(value)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"integer expected, got {type(value).__name__}")
    if value < 0 or value >= (1 << 256):
        raise ValueError(f"uint out of range: {value}")
    return value.to_bytes(32, "big")


def enc_bool(value) -> bytes:
    """`approved` is a bool. EIP-712 encodes it as a full word, 0 or 1 — and the contract
    masks it to one bit (`and(approved, 0x1)` in ERC721PermitHash), so anything else was
    never going to mean what it looked like."""
    if isinstance(value, str):
        value = {"true": True, "false": False}[value.lower()]
    if not isinstance(value, bool):
        raise ValueError(f"bool expected, got {type(value).__name__}")
    return enc_uint(1 if value else 0)


def enc_address(addr: str) -> bytes:
    raw = bytes.fromhex(addr[2:] if addr.lower().startswith("0x") else addr)
    if len(raw) != 20:
        raise ValueError(f"address must be 20 bytes, got {len(raw)}: {addr}")
    return b"\x00" * 12 + raw


# --- domains -------------------------------------------------------------------

def domain_v3(name: str, version: str, chain_id, verifying_contract: str) -> bytes:
    """Four fields. This is the shape almost every contract uses — and the one Permit2
    does NOT use, which is why a single shared builder gets one of them wrong."""
    return keccak256(
        type_hash(TS_DOMAIN_4)
        + keccak256(name.encode())
        + keccak256(version.encode())
        + enc_uint(chain_id)
        + enc_address(verifying_contract)
    )


def domain_v4(name: str, chain_id, verifying_contract: str) -> bytes:
    """Three fields, no version — same shape as Permit2, different name and address.
    EIP712_v4 hashes the ERC-721 `name()`, so the domain name is the NFT's name string."""
    return keccak256(
        type_hash(TS_DOMAIN_3)
        + keccak256(name.encode())
        + enc_uint(chain_id)
        + enc_address(verifying_contract)
    )


def digest(domain_sep: bytes, struct_hash: bytes) -> bytes:
    return keccak256(b"\x19\x01" + domain_sep + struct_hash)


# --- struct hashes -------------------------------------------------------------

def hash_permit(m: dict) -> bytes:
    """Identical bytes for v3 and v4 — the families differ only in the domain."""
    return keccak256(
        type_hash(TS_PERMIT)
        + enc_address(m["spender"])
        + enc_uint(m["tokenId"])
        + enc_uint(m["nonce"])
        + enc_uint(m["deadline"])
    )


def hash_permit_for_all(m: dict) -> bytes:
    """v4 only. There is no amount and no tokenId here: `approved = true` hands one
    address control of every position the owner holds, now and in the future.

    This is the unbounded approval of the position path, and unlike Permit2's
    type(uint160).max it has no field to put a ceiling in — the only bound available to a
    signer is the deadline."""
    return keccak256(
        type_hash(TS_PERMIT_FOR_ALL)
        + enc_address(m["operator"])
        + enc_bool(m["approved"])
        + enc_uint(m["nonce"])
        + enc_uint(m["deadline"])
    )
