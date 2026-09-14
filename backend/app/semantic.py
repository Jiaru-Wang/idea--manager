"""Small, deterministic and entirely local semantic index for IdeaMiner.

It deliberately indexes only working titles and notes.  Original raw captures are
never read here.  The `idea_embeddings` table remains model-agnostic, so a future
on-device or hosted embedding model can write a second model row without a schema
change.
"""

from __future__ import annotations

import hashlib
import math
import re
import sqlite3
import struct
from collections import Counter, defaultdict
from typing import Any


MODEL = "local-random-index-v1"
DIMENSIONS = 128
MAX_VOCABULARY = 2500
_TOKEN = re.compile(r"[\w-]{3,}", flags=re.UNICODE)
_STOPWORDS = frozenset({
    "about", "after", "again", "also", "among", "and", "are", "because", "been", "being", "between",
    "but", "can", "could", "each", "for", "from", "have", "ideas", "into", "its", "more", "not",
    "notes", "other", "our", "over", "that", "the", "their", "there", "these", "this", "those",
    "through", "under", "use", "using", "was", "were", "when", "which", "with", "would", "your",
})


def _tokens(title: str, content: str) -> list[str]:
    return [token.lower() for token in _TOKEN.findall(f"{title} {content}") if token.lower() not in _STOPWORDS]


def _basis(token: str) -> list[tuple[int, float]]:
    """A deterministic sparse signed vector, without downloading a model."""
    digest = hashlib.sha256(token.encode("utf-8")).digest()
    values: list[tuple[int, float]] = []
    used: set[int] = set()
    for offset in range(0, 24, 3):
        index = int.from_bytes(digest[offset : offset + 2], "little") % DIMENSIONS
        if index not in used:
            used.add(index)
            values.append((index, 1.0 if digest[offset + 2] & 1 else -1.0))
    return values


def _normalize(vector: list[float]) -> list[float]:
    length = math.sqrt(sum(value * value for value in vector))
    return [value / length for value in vector] if length else vector


def _packed(vector: list[float]) -> bytes:
    return struct.pack(f"<{DIMENSIONS}f", *vector)


def unpack(vector: bytes, dimensions: int) -> list[float]:
    if dimensions != DIMENSIONS or len(vector) != dimensions * 4:
        return []
    return list(struct.unpack(f"<{dimensions}f", vector))


def rebuild(connection: sqlite3.Connection) -> dict[str, Any]:
    """Rebuild the lightweight co-occurrence index and replace only this model."""
    rows = connection.execute(
        """SELECT i.id, i.title, i.content, i.updated_at
           FROM ideas i JOIN projects p ON p.id=i.project_id
           WHERE COALESCE(p.system_key, '') <> 'recycle' ORDER BY i.id"""
    ).fetchall()
    documents = [(int(row["id"]), _tokens(row["title"], row["content"]), row["title"], row["content"], row["updated_at"]) for row in rows]
    counts = Counter(token for _, tokens, *_ in documents for token in tokens)
    vocabulary = {token for token, _ in counts.most_common(MAX_VOCABULARY)}
    context: dict[str, list[float]] = defaultdict(lambda: [0.0] * DIMENSIONS)
    for _, tokens, *_ in documents:
        present = Counter(token for token in tokens if token in vocabulary)
        if not present:
            continue
        document_vector = [0.0] * DIMENSIONS
        for token, frequency in present.items():
            weight = 1.0 + math.log(frequency)
            for index, sign in _basis(token):
                document_vector[index] += sign * weight
        for token, frequency in present.items():
            weight = 1.0 + math.log(frequency)
            item = context[token]
            for index, value in enumerate(document_vector):
                item[index] += value * weight

    connection.execute("DELETE FROM idea_embeddings WHERE model=?", (MODEL,))
    indexed = 0
    for idea_id, tokens, title, content, updated_at in documents:
        present = Counter(token for token in tokens if token in vocabulary)
        vector = [0.0] * DIMENSIONS
        for token, frequency in present.items():
            weight = 1.0 + math.log(frequency)
            item = context[token]
            for index, value in enumerate(item):
                vector[index] += value * weight
        vector = _normalize(vector)
        if not any(vector):
            continue
        content_hash = hashlib.sha256(f"{title}\0{content}\0{updated_at}\0{MODEL}".encode("utf-8")).hexdigest()
        connection.execute(
            "INSERT INTO idea_embeddings(idea_id, model, dimensions, vector, content_hash) VALUES (?, ?, ?, ?, ?)",
            (idea_id, MODEL, DIMENSIONS, _packed(vector), content_hash),
        )
        indexed += 1
    return {"model": MODEL, "dimensions": DIMENSIONS, "indexed_ideas": indexed}


def similarity(left: bytes, right: bytes, dimensions: int) -> float:
    left_values, right_values = unpack(left, dimensions), unpack(right, dimensions)
    if not left_values or not right_values:
        return 0.0
    return sum(a * b for a, b in zip(left_values, right_values))
