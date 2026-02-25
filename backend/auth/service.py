"""Authentication service for JWT and admin user management"""

import json
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from passlib.context import CryptContext
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.models.orm import Settings

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hash a password using bcrypt"""
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plain password against a bcrypt hash"""
    return pwd_context.verify(plain, hashed)


async def get_admin_user(db: AsyncSession) -> Optional[Dict[str, Any]]:
    """Retrieve admin user from settings table"""
    stmt = select(Settings).where(Settings.key == "admin_user")
    result = await db.execute(stmt)
    setting = result.scalars().first()
    if setting and setting.value:
        return setting.value
    return None


async def initialize_admin_user(db: AsyncSession) -> None:
    """Initialize admin user on startup if it doesn't exist"""
    admin_user = await get_admin_user(db)
    if admin_user:
        return  # Already exists
    
    # Create new admin user
    hashed_password = hash_password(settings.admin_password)
    admin_data = {
        "username": settings.admin_username,
        "hashed_password": hashed_password,
    }
    
    # Check if settings row exists, if not create it
    stmt = select(Settings).where(Settings.key == "admin_user")
    result = await db.execute(stmt)
    setting = result.scalars().first()
    
    if setting:
        setting.value = admin_data
    else:
        setting = Settings(key="admin_user", value=admin_data)
        db.add(setting)
    
    await db.commit()


async def authenticate_user(db: AsyncSession, username: str, password: str) -> Optional[Dict[str, Any]]:
    """Authenticate user and return user dict if valid"""
    admin_user = await get_admin_user(db)
    
    if not admin_user:
        return None
    
    if admin_user.get("username") != username:
        return None
    
    if not verify_password(password, admin_user.get("hashed_password", "")):
        return None
    
    return {"username": admin_user["username"]}


async def change_password(db: AsyncSession, new_password: str) -> None:
    """Change admin user password"""
    admin_user = await get_admin_user(db)
    if not admin_user:
        raise ValueError("Admin user not found")
    
    hashed_password = hash_password(new_password)
    admin_user["hashed_password"] = hashed_password
    
    stmt = select(Settings).where(Settings.key == "admin_user")
    result = await db.execute(stmt)
    setting = result.scalars().first()
    
    if setting:
        setting.value = admin_user
        await db.commit()


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token"""
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    
    encoded_jwt = jwt.encode(
        to_encode,
        settings.secret_key,
        algorithm="HS256"
    )
    return encoded_jwt


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and validate JWT access token"""
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=["HS256"]
        )
        return payload
    except JWTError:
        return None
