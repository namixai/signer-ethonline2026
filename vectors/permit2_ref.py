"""Path A — our own EIP-712 encoder for Permit2. Standard library only.

Deliberately hand-rolled: no eth-abi, no web3, no eth_account. The only primitive
borrowed from anywhere is keccak256, and that one is implemented from the Keccak
permutation in `keccak_min.py` and pinned to golden vectors.

If this file and `verify_sdk.mjs` (Uniswap's own SDK) ever disagree on a digest,
that disagreement is the finding — not a rounding difference to be papered over.

Sources read to write this file (pinned commit Uniswap/permit2
cc56ad0f3439c502c246fc5cfcc3db92bb8b7219):
  src/EIP712.sol                — 3-field domain, `name = "Permit2"`, no `version`
  src/libraries/PermitHash.sol  — every type string below is copied from there verbatim
  src/AllowanceTransfer.sol     — permit() / _updateApproval() / _transfer()
  src/SignatureTransfer.sol     — _permitTransferFrom(), unordered nonce bitmap
"""

from keccak_min import keccak256

# --- Type strings. Copied character-for-character from PermitHash.sol. ---------
# A retyped-from-memory string produces a valid signature that the contract rejects,
# so these are the one place in the file where paraphrase is forbidden.

TS_PERMIT_DETAILS = "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"

TS_PERMIT_SINGLE = (
    "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)"
    "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
)

TS_PERMIT_BATCH = (
    "PermitBatch(PermitDetails[] details,address spender,uint256 sigDeadline)"
    "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
)

TS_TOKEN_PERMISSIONS = "TokenPermissions(address token,uint256 amount)"

TS_PERMIT_TRANSFER_FROM = (
    "PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)"
    "TokenPermissions(address token,uint256 amount)"
)

TS_PERMIT_BATCH_TRANSFER_FROM = (
    "PermitBatchTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline)"
    "TokenPermissions(address token,uint256 amount)"
)

# Witness variants are built at call time: the stub below is concatenated with a
# caller-supplied tail. Permit2 does not parse or validate that tail (see the spec).
STUB_WITNESS_SINGLE = (
    "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,"
)
STUB_WITNESS_BATCH = (
    "PermitBatchWitnessTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline,"
)

TS_EIP712_DOMAIN_3 = "EIP712Domain(string name,uint256 chainId,address verifyingContract)"

PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3"

UINT160_MAX = (1 << 160) - 1
UINT48_MAX = (1 << 48) - 1


# --- primitive encoders -------------------------------------------------------

def type_hash(type_string: str) -> bytes:
    return keccak256(type_string.encode())


def enc_uint(value) -> bytes:
    """EIP-712 encodes every integer as a full 32-byte big-endian word, whatever
    width the type string declares. uint48 does NOT get packed into 6 bytes.

    Accepts a decimal string as well as an int, and the vector file uses strings on
    purpose: a JSON number is an IEEE-754 double on the JavaScript side, and
    type(uint160).max comes back off by one from JSON.parse — landing on the far
    side of the exact boundary that decides whether a Permit2 approval is infinite.
    """
    if isinstance(value, str):
        if not value.isdigit():
            raise ValueError(f"integer must be a decimal string, got {value!r}")
        value = int(value)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"integer expected, got {type(value).__name__}")
    if value < 0 or value >= (1 << 256):
        raise ValueError(f"uint out of range: {value}")
    return value.to_bytes(32, "big")


def enc_address(addr: str) -> bytes:
    """An address is left-padded to 32 bytes. We refuse anything with bits above
    the 159th set: those bits carry no meaning here, and signing a word whose
    meaning we have not modelled is exactly what the enclave must not do."""
    raw = bytes.fromhex(addr[2:] if addr.lower().startswith("0x") else addr)
    if len(raw) != 20:
        raise ValueError(f"address must be 20 bytes, got {len(raw)}: {addr}")
    return b"\x00" * 12 + raw


def enc_bool(value: bool) -> bytes:
    return enc_uint(1 if value else 0)


def enc_bytes32(hexstr: str) -> bytes:
    raw = bytes.fromhex(hexstr[2:] if hexstr.lower().startswith("0x") else hexstr)
    if len(raw) != 32:
        raise ValueError(f"bytes32 must be 32 bytes, got {len(raw)}")
    return raw


# --- domain -------------------------------------------------------------------

def domain_separator(chain_id: int, verifying_contract: str = PERMIT2_ADDRESS) -> bytes:
    """Permit2's domain has THREE fields. There is no `version`.

    EIP712.sol: keccak256(abi.encode(_TYPE_HASH, _HASHED_NAME, block.chainid, address(this)))
    Copying the near-universal 4-field domain here yields a valid signature that
    Permit2 rejects with InvalidSigner, and nothing tells you why.
    """
    return keccak256(
        type_hash(TS_EIP712_DOMAIN_3)
        + keccak256(b"Permit2")
        + enc_uint(chain_id)
        + enc_address(verifying_contract)
    )


def digest(domain_sep: bytes, struct_hash: bytes) -> bytes:
    return keccak256(b"\x19\x01" + domain_sep + struct_hash)


# --- AllowanceTransfer --------------------------------------------------------

def hash_permit_details(d: dict) -> bytes:
    return keccak256(
        type_hash(TS_PERMIT_DETAILS)
        + enc_address(d["token"])
        + enc_uint(d["amount"])
        + enc_uint(d["expiration"])
        + enc_uint(d["nonce"])
    )


def hash_permit_single(p: dict) -> bytes:
    """A struct member enters as its own hashStruct, not as its fields inline."""
    return keccak256(
        type_hash(TS_PERMIT_SINGLE)
        + hash_permit_details(p["details"])
        + enc_address(p["spender"])
        + enc_uint(p["sigDeadline"])
    )


def hash_permit_batch(p: dict) -> bytes:
    """An array of structs enters as keccak of the concatenated member hashes."""
    inner = b"".join(hash_permit_details(d) for d in p["details"])
    return keccak256(
        type_hash(TS_PERMIT_BATCH)
        + keccak256(inner)
        + enc_address(p["spender"])
        + enc_uint(p["sigDeadline"])
    )


# --- SignatureTransfer --------------------------------------------------------

def hash_token_permissions(tp: dict) -> bytes:
    return keccak256(
        type_hash(TS_TOKEN_PERMISSIONS) + enc_address(tp["token"]) + enc_uint(tp["amount"])
    )


def hash_permit_transfer_from(p: dict, spender: str) -> bytes:
    """`spender` is NOT a field of the Solidity struct. PermitHash.hash() substitutes
    `msg.sender`, so the signer is binding the permit to whoever calls Permit2.
    The caller of this function must supply that address explicitly — there is no
    default, because getting it wrong silently authorises the wrong contract."""
    return keccak256(
        type_hash(TS_PERMIT_TRANSFER_FROM)
        + hash_token_permissions(p["permitted"])
        + enc_address(spender)
        + enc_uint(p["nonce"])
        + enc_uint(p["deadline"])
    )


def hash_permit_batch_transfer_from(p: dict, spender: str) -> bytes:
    inner = b"".join(hash_token_permissions(tp) for tp in p["permitted"])
    return keccak256(
        type_hash(TS_PERMIT_BATCH_TRANSFER_FROM)
        + keccak256(inner)
        + enc_address(spender)
        + enc_uint(p["nonce"])
        + enc_uint(p["deadline"])
    )


def witness_type_hash(stub: str, witness_type_string: str) -> bytes:
    return keccak256((stub + witness_type_string).encode())


def hash_permit_witness_transfer_from(p: dict, spender: str, witness: bytes,
                                      witness_type_string: str) -> bytes:
    return keccak256(
        witness_type_hash(STUB_WITNESS_SINGLE, witness_type_string)
        + hash_token_permissions(p["permitted"])
        + enc_address(spender)
        + enc_uint(p["nonce"])
        + enc_uint(p["deadline"])
        + witness
    )


def hash_permit_batch_witness_transfer_from(p: dict, spender: str, witness: bytes,
                                            witness_type_string: str) -> bytes:
    inner = b"".join(hash_token_permissions(tp) for tp in p["permitted"])
    return keccak256(
        witness_type_hash(STUB_WITNESS_BATCH, witness_type_string)
        + keccak256(inner)
        + enc_address(spender)
        + enc_uint(p["nonce"])
        + enc_uint(p["deadline"])
        + witness
    )


# --- the witness used by the vectors -----------------------------------------
# A deliberately ordinary integrator witness: "these tokens may move, but only as
# part of this swap, to this recipient, for at least this much out".

TS_SWAP_INTENT = "SwapIntent(address recipient,address tokenOut,uint256 minAmountOut)"
# EIP-712 orders referenced types alphabetically: SwapIntent < TokenPermissions.
WITNESS_TYPE_STRING_SWAP_INTENT = "SwapIntent witness)" + TS_SWAP_INTENT + TS_TOKEN_PERMISSIONS


def hash_swap_intent(w: dict) -> bytes:
    return keccak256(
        type_hash(TS_SWAP_INTENT)
        + enc_address(w["recipient"])
        + enc_address(w["tokenOut"])
        + enc_uint(w["minAmountOut"])
    )
