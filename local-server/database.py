import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker
from config import settings

DATABASE_URL = settings.DATABASE_URL

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 15} if DATABASE_URL.startswith("sqlite") else {},
    echo=False
)

# Enable WAL mode, foreign keys, and busy timeout in SQLite for reliable concurrent operations
if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db(engine_to_use=engine, seed=True):
    """Initializes tables and optionally seeds default menu items."""
    import models
    Base.metadata.create_all(bind=engine_to_use)

    if seed:
        db = sessionmaker(autocommit=False, autoflush=False, bind=engine_to_use)()
        try:
            if db.query(models.MenuItem).count() == 0:
                sample_items = [
                    {"sku": "COF-001", "name": "Artisan Espresso", "category": "Coffee", "price_paise": 18000, "stock": 100, "low_stock": 20, "desc": "Double shot roasted Arabica blend"},
                    {"sku": "COF-002", "name": "Caffè Americano", "category": "Coffee", "price_paise": 20000, "stock": 95, "low_stock": 20, "desc": "Espresso poured over hot mineral water"},
                    {"sku": "COF-003", "name": "Velvet Cappuccino", "category": "Coffee", "price_paise": 24000, "stock": 80, "low_stock": 15, "desc": "Espresso with steamed milk and velvety foam"},
                    {"sku": "COF-004", "name": "Salted Caramel Latte", "category": "Coffee", "price_paise": 28000, "stock": 60, "low_stock": 15, "desc": "Rich caramel syrup with espresso and textured milk"},
                    {"sku": "COF-005", "name": "Cold Brew Reserve", "category": "Coffee", "price_paise": 26000, "stock": 45, "low_stock": 10, "desc": "Steeped for 18 hours, smooth low acidity"},
                    {"sku": "TEA-001", "name": "Japanese Iced Matcha Latte", "category": "Tea", "price_paise": 29000, "stock": 40, "low_stock": 10, "desc": "Ceremonial Uji matcha whisked with oat milk"},
                    {"sku": "TEA-002", "name": "Earl Grey Supreme", "category": "Tea", "price_paise": 19000, "stock": 70, "low_stock": 15, "desc": "Ceylon black tea infused with bergamot oil"},
                    {"sku": "BAK-001", "name": "Butter Flaky Croissant", "category": "Bakery", "price_paise": 16000, "stock": 25, "low_stock": 8, "desc": "French-style multi-layered butter pastry"},
                    {"sku": "BAK-002", "name": "Pain au Chocolat", "category": "Bakery", "price_paise": 21000, "stock": 20, "low_stock": 6, "desc": "Dark Belgian chocolate pastry"},
                    {"sku": "FOD-001", "name": "Sourdough Avocado Toast", "category": "Food", "price_paise": 38000, "stock": 15, "low_stock": 5, "desc": "Smashed avocado, chilli flakes on toasted sourdough"},
                    {"sku": "FOD-002", "name": "Truffle Grilled Cheese", "category": "Food", "price_paise": 42000, "stock": 12, "low_stock": 4, "desc": "Aged cheddar, gruyère and black truffle butter"},
                    {"sku": "DES-001", "name": "Basque Burnt Cheesecake", "category": "Desserts", "price_paise": 32000, "stock": 10, "low_stock": 3, "desc": "Caramelized crust with creamy custard center"}
                ]
                for item in sample_items:
                    db.add(models.MenuItem(
                        sku=item["sku"],
                        name=item["name"],
                        category=item["category"],
                        price_paise=item["price_paise"],
                        stock=item["stock"],
                        low_stock_threshold=item["low_stock"],
                        description=item["desc"],
                        is_available=True
                    ))
                db.commit()
        finally:
            db.close()
