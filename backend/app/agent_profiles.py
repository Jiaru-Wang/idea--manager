from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

from .database import DB_PATH

try:
    import keyring
    from keyring.errors import KeyringError
except ImportError:  # pragma: no cover - exercised on minimal developer installs
    keyring = None

    class KeyringError(Exception):
        pass


SERVICE_NAME = "IdeaMiner"


class CredentialStoreError(RuntimeError):
    pass


def profile_path() -> Path:
    override = os.environ.get("IDEAMINER_AGENT_PROFILE_PATH", "").strip()
    return Path(override) if override else DB_PATH.parent / "agent-profiles.json"


def _account(provider: str) -> str:
    library = str(DB_PATH.resolve()).casefold().encode("utf-8")
    library_id = hashlib.sha256(library).hexdigest()[:20]
    return f"{library_id}:{provider}"


def load_store() -> dict[str, Any]:
    path = profile_path()
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"version": 1, "active_provider": "openai", "profiles": {}}
    if not isinstance(value, dict):
        return {"version": 1, "active_provider": "openai", "profiles": {}}
    profiles = value.get("profiles")
    return {
        "version": 1,
        "active_provider": str(value.get("active_provider") or "openai"),
        "profiles": profiles if isinstance(profiles, dict) else {},
    }


def save_store(value: dict[str, Any]) -> None:
    path = profile_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        temporary.chmod(0o600)
    except OSError:
        pass
    os.replace(temporary, path)


def save_profile(provider: str, profile: dict[str, str], *, active: bool = True) -> None:
    store = load_store()
    store["profiles"][provider] = {
        "model": profile.get("model", ""),
        "base_url": profile.get("base_url", ""),
        "reasoning_effort": profile.get("reasoning_effort", ""),
    }
    if active:
        store["active_provider"] = provider
    save_store(store)


def set_active_provider(provider: str) -> None:
    store = load_store()
    store["active_provider"] = provider
    save_store(store)


def reset_profile(provider: str) -> None:
    store = load_store()
    store["profiles"].pop(provider, None)
    save_store(store)


def credential_store_available() -> bool:
    if keyring is None or os.environ.get("IDEAMINER_DISABLE_KEYRING") == "1":
        return False
    try:
        return int(getattr(keyring.get_keyring(), "priority", 0)) > 0
    except Exception:
        return False


def get_api_key(provider: str) -> str:
    if not credential_store_available():
        return ""
    try:
        return str(keyring.get_password(SERVICE_NAME, _account(provider)) or "")
    except (KeyringError, RuntimeError):
        return ""


def save_api_key(provider: str, api_key: str) -> None:
    if not credential_store_available():
        raise CredentialStoreError("Secure credential storage is unavailable on this computer")
    try:
        keyring.set_password(SERVICE_NAME, _account(provider), api_key)
    except (KeyringError, RuntimeError) as error:
        raise CredentialStoreError(f"Could not save the credential securely: {error}") from error


def delete_api_key(provider: str) -> None:
    if not credential_store_available():
        return
    try:
        keyring.delete_password(SERVICE_NAME, _account(provider))
    except (KeyringError, RuntimeError):
        pass
