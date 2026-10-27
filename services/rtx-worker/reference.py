"""Independent NumPy transcript oracle. Offline validation; no coordinator calls."""
import numpy as np
from protocol import ROWS, COLS, TILES, RANK


def fold(c, transcripts, chunk):
    slot = chunk % 16
    h = np.array([np.bitwise_xor.reduce(c[np.ix_(ROWS + ro, COLS + co)].astype(np.uint32).ravel()) for ro, co in TILES], dtype=np.uint32)
    v = transcripts[:, slot]
    transcripts[:, slot] = ((v << np.uint32(13)) | (v >> np.uint32(19))) ^ h


def compute(an, btn):
    """Compute every partial-sum transcript using host integer arithmetic."""
    if an.shape != btn.shape or an.shape[0] != 128 or an.shape[1] not in (2048, 4096):
        raise ValueError("Invalid reference input shape")
    c = np.zeros((128, 128), dtype=np.int32)
    tr = np.zeros((len(TILES), 16), dtype=np.uint32)
    for p in range(0, an.shape[1], RANK):
        partial = an[:, p:p+RANK].astype(np.int64) @ btn[:, p:p+RANK].astype(np.int64).T
        c += partial.astype(np.int32)
        fold(c, tr, p // RANK)
    return c, tr


def selected_transcript(an, btn, tile):
    """Recompute only the selected opened tile before publishing a proof."""
    ro, co = TILES[tile]
    a, bt = an[ROWS + ro].astype(np.int64), btn[COLS + co].astype(np.int64)
    sums = np.zeros((4, 8), dtype=np.int64)
    words = np.zeros(16, dtype=np.uint32)
    for p in range(0, an.shape[1], RANK):
        sums += a[:, p:p+RANK] @ bt[:, p:p+RANK].T
        h = np.bitwise_xor.reduce(sums.astype(np.uint32).ravel())
        slot = (p // RANK) % 16
        v = int(words[slot])
        words[slot] = (((v << 13) | (v >> 19)) & 0xffffffff) ^ int(h)
    return words
