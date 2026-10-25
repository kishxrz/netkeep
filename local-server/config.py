import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./netkeep_local.db")
    BRANCH_ID: str = os.getenv("BRANCH_ID", "CAFE-BLR-01")
    BRANCH_NAME: str = os.getenv("BRANCH_NAME", "NetKeep Cyber Arena Indiranagar")
    CLOUD_API_URL: str = os.getenv("CLOUD_API_URL", "http://localhost:8001/api/v1")
    
    # Trusted LAN API Key for POS terminal authentication
    LAN_API_KEY: str = os.getenv("LAN_API_KEY", "netkeep-pos-lan-key-2026")
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    ALLOWED_ORIGINS: str = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
