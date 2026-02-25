"""Application configuration using Pydantic Settings"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""
    
    # Database
    database_url: str = "postgresql+asyncpg://woodoo:woodoo@postgres:5432/woodoo"
    
    # Redis
    redis_url: str = "redis://redis:6379/0"
    
    # Security
    secret_key: str = "your-secret-key-change-in-production"
    
    # Admin credentials
    admin_username: str = "admin"
    admin_password: str = "changeme"
    
    # Token expiration
    access_token_expire_minutes: int = 1440  # 24 hours
    
    # Environment
    environment: str = "development"
    
    # Webhook secrets
    wc_webhook_secret: str = ""
    odoo_webhook_secret: str = ""

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
