import os
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

logger = logging.getLogger("netkeep.cloud.database")

# Environment variables
RAW_DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
# STRICT RULE: Supabase service-role key is loaded SERVER-SIDE ONLY and never exposed to clients
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

# Database engine initialization
if RAW_DATABASE_URL:
    # Ensure PostgreSQL URLs explicitly use the postgresql+psycopg2:// dialect for psycopg2-binary
    if RAW_DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = RAW_DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
    elif RAW_DATABASE_URL.startswith("postgresql://"):
        DATABASE_URL = RAW_DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)
    else:
        DATABASE_URL = RAW_DATABASE_URL

    is_postgres = DATABASE_URL.startswith("postgresql")
    connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
    
    engine_kwargs = {
        "connect_args": connect_args,
        "echo": False
    }
    if is_postgres:
        # Optimized connection pooling for Supabase PgBouncer (Session & Transaction poolers)
        engine_kwargs.update({
            "pool_pre_ping": True,
            "pool_recycle": 300,
            "pool_size": int(os.getenv("DB_POOL_SIZE", "10")),
            "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "20"))
        })
        
    engine = create_engine(DATABASE_URL, **engine_kwargs)
    if is_postgres:
        print("[DATABASE] Successfully connected to Supabase PostgreSQL")
    else:
        print(f"[DATABASE] Connected to {DATABASE_URL.split('://')[0]} database")
else:
    # Graceful local development fallback when Supabase credentials are absent
    DATABASE_URL = "sqlite:///./netkeep_cloud.db"
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        echo=False
    )
    print("[DATABASE] Supabase DATABASE_URL not set. Running in local development mode with SQLite.")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_active_database_mode() -> str:
    """Returns a clean human-readable descriptor of the active backend database."""
    if RAW_DATABASE_URL.startswith("postgresql") or RAW_DATABASE_URL.startswith("postgres"):
        return "Supabase PostgreSQL"
    elif RAW_DATABASE_URL:
        return f"{RAW_DATABASE_URL.split('://')[0].capitalize()} (Custom URI)"
    return "SQLite (Local Fallback)"

def get_cloud_db():
    """FastAPI database session dependency."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
