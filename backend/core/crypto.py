"""Fernet-based encryption utility for storing API credentials at rest."""

import base64
import json
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from backend.core.config import settings

# Key derivation constants
PBKDF2_SALT = b"woodoo-v1-salt"  # Fixed salt (security acceptable here since key rotates via SECRET_KEY change)
PBKDF2_ITERATIONS = 480000
KEY_VERSION = "v1"


class EncryptionError(Exception):
    """Raised when encryption/decryption fails"""
    pass


def _derive_key(secret_key: str) -> bytes:
    """Derive Fernet key from SECRET_KEY using PBKDF2-HMAC-SHA256"""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=PBKDF2_SALT,
        iterations=PBKDF2_ITERATIONS,
    )
    key_bytes = kdf.derive(secret_key.encode("utf-8"))
    return base64.urlsafe_b64encode(key_bytes)


def _get_fernet() -> Fernet:
    """Get Fernet instance using current SECRET_KEY"""
    key = _derive_key(settings.secret_key)
    return Fernet(key)


def encrypt_config(config_dict: dict) -> str:
    """
    Encrypt a config dict to a string.
    Returns: "{KEY_VERSION}:{base64_encrypted_json}"
    """
    try:
        f = _get_fernet()
        plaintext = json.dumps(config_dict).encode("utf-8")
        encrypted = f.encrypt(plaintext)
        payload = f"{KEY_VERSION}:{encrypted.decode('utf-8')}"
        return payload
    except Exception as e:
        raise EncryptionError(f"Encryption failed: {e}") from e


def decrypt_config(encrypted_str: str) -> dict:
    """
    Decrypt an encrypted config string back to dict.
    Raises EncryptionError on invalid token, wrong key, or corrupted data.
    """
    try:
        # Parse version prefix
        if ":" not in encrypted_str:
            raise EncryptionError("Invalid encrypted format: missing version prefix")
        version, encrypted_data = encrypted_str.split(":", 1)
        if version != KEY_VERSION:
            raise EncryptionError(f"Unsupported key version: {version}")
        f = _get_fernet()
        decrypted = f.decrypt(encrypted_data.encode("utf-8"))
        return json.loads(decrypted.decode("utf-8"))
    except (InvalidToken, ValueError) as e:
        raise EncryptionError(f"Decryption failed: invalid token or wrong key") from e
    except EncryptionError:
        raise
    except Exception as e:
        raise EncryptionError(f"Decryption failed: {e}") from e
