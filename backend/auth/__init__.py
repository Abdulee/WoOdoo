"""Authentication module"""

from backend.auth.service import (
    hash_password,
    verify_password,
    initialize_admin_user,
    authenticate_user,
    change_password,
    create_access_token,
    decode_access_token,
)
from backend.auth.router import router
from backend.auth.middleware import JWTMiddleware
from backend.auth.dependencies import get_current_user, oauth2_scheme

__all__ = [
    "hash_password",
    "verify_password",
    "initialize_admin_user",
    "authenticate_user",
    "change_password",
    "create_access_token",
    "decode_access_token",
    "router",
    "JWTMiddleware",
    "get_current_user",
    "oauth2_scheme",
]
