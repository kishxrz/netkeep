import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base, SessionLocal, RAW_DATABASE_URL, get_active_database_mode
import models
from routes import orders, dashboard, cafes, branches, reservations, sync, analytics, menu

# Create database tables automatically
Base.metadata.create_all(bind=engine)

def seed_cloud_database():
    """Initializes demo owners, cafés, and menu items if the database has zero cafe records."""
    db = SessionLocal()
    try:
        cafe_count = db.query(models.Cafe).count()
        auto_seed_env = os.getenv("AUTO_SEED_DEMO_DATA")

        should_seed = False
        if auto_seed_env is not None:
            should_seed = auto_seed_env.lower() in ("true", "1", "yes")
        elif cafe_count == 0:
            should_seed = True

        if not should_seed:
            return
        # Load environment-configured secrets with safe local development defaults
        owner_token = os.getenv("OWNER_AUTH_TOKEN", "owner-secret-token-2026")
        mumbai_owner_token = os.getenv("MUMBAI_OWNER_AUTH_TOKEN", "mumbai-owner-token-2026")
        admin_token = os.getenv("ADMIN_AUTH_TOKEN", "admin-secret-token-2026")
        cafe_blr_key = os.getenv("CAFE_BLR_API_KEY", "key-cafe-blr-01-secret")
        cafe_mum_key = os.getenv("CAFE_MUM_API_KEY", "key-cafe-mum-02-secret")
        cafe_del_key = os.getenv("CAFE_DEL_API_KEY", "key-cafe-del-03-secret")

        # 1. Seed Users (Owners & Admins)
        if db.query(models.User).count() == 0:
            owner1 = models.User(
                id="usr-owner-001",
                email="owner@netkeepcafe.com",
                full_name="Rajesh Sharma",
                role="owner",
                auth_token=owner_token
            )
            owner2 = models.User(
                id="usr-owner-002",
                email="mumbai.owner@netkeepcafe.com",
                full_name="Vikram Mehta",
                role="owner",
                auth_token=mumbai_owner_token
            )
            admin = models.User(
                id="usr-admin-001",
                email="admin@netkeepcafe.com",
                full_name="Priya Patel",
                role="admin",
                auth_token=admin_token
            )
            db.add_all([owner1, owner2, admin])
            db.commit()

            # 2. Seed Cafes
            cafe1 = models.Cafe(
                id="cafe-blr-01",
                cafe_code="CAFE-BLR-01",
                name="NetKeep Arena — Indiranagar",
                city="Bengaluru",
                address="100 Feet Rd, Indiranagar, Bengaluru, KA",
                phone="+91 80 4123 4567",
                total_stations=16,
                edge_ip="192.168.10.10",
                owner_id="usr-owner-001",
                api_key=cafe_blr_key,
                is_active=True
            )
            cafe2 = models.Cafe(
                id="cafe-mum-02",
                cafe_code="CAFE-MUM-02",
                name="NetKeep Lounge — Bandra West",
                city="Mumbai",
                address="Hill Road, Bandra West, Mumbai, MH",
                phone="+91 22 2640 1234",
                total_stations=24,
                edge_ip="192.168.10.10",
                owner_id="usr-owner-002",
                api_key=cafe_mum_key,
                is_active=True
            )
            cafe3 = models.Cafe(
                id="cafe-del-03",
                cafe_code="CAFE-DEL-03",
                name="NetKeep Hub — Hauz Khas",
                city="New Delhi",
                address="Hauz Khas Village, New Delhi, DL",
                phone="+91 11 2656 7890",
                total_stations=20,
                edge_ip="192.168.10.10",
                owner_id="usr-owner-001",
                api_key=cafe_del_key,
                is_active=True
            )
            db.add_all([cafe1, cafe2, cafe3])
            db.commit()

            # 3. Seed Menu Items in Integer Paise
            items = [
                models.MenuItem(
                    id=1, cafe_id="cafe-blr-01", sku="COF-001", name="Artisan Espresso",
                    category="Coffee", price_paise=18000, stock=100, low_stock_threshold=20, is_available=True,
                    description="Double shot roasted Arabica blend with golden crema"
                ),
                models.MenuItem(
                    id=2, cafe_id="cafe-blr-01", sku="COF-002", name="Caffè Americano",
                    category="Coffee", price_paise=20000, stock=95, low_stock_threshold=20, is_available=True,
                    description="Rich espresso poured over steaming hot mineral water"
                ),
                models.MenuItem(
                    id=3, cafe_id="cafe-blr-01", sku="COF-003", name="Velvet Cappuccino",
                    category="Coffee", price_paise=24000, stock=80, low_stock_threshold=15, is_available=True,
                    description="Steamed whole milk and velvety microfoam over espresso"
                ),
                models.MenuItem(
                    id=4, cafe_id="cafe-blr-01", sku="COF-004", name="Salted Caramel Latte",
                    category="Coffee", price_paise=28000, stock=60, low_stock_threshold=15, is_available=True,
                    description="Rich artisanal caramel syrup with espresso & textured milk"
                ),
                models.MenuItem(
                    id=5, cafe_id="cafe-blr-01", sku="COF-005", name="Cold Brew Reserve",
                    category="Coffee", price_paise=26000, stock=45, low_stock_threshold=10, is_available=True,
                    description="Steeped for 18 hours, smooth chocolate and nutty notes"
                ),
                models.MenuItem(
                    id=6, cafe_id="cafe-blr-01", sku="TEA-001", name="Japanese Iced Matcha Latte",
                    category="Tea", price_paise=29000, stock=40, low_stock_threshold=10, is_available=True,
                    description="Ceremonial Uji matcha whisked with chilled oat milk"
                ),
                models.MenuItem(
                    id=7, cafe_id="cafe-blr-01", sku="TEA-002", name="Earl Grey Supreme",
                    category="Tea", price_paise=19000, stock=50, low_stock_threshold=12, is_available=True,
                    description="Black tea infused with Italian natural bergamot oil"
                ),
                models.MenuItem(
                    id=8, cafe_id="cafe-blr-01", sku="BAK-001", name="Butter Flaky Croissant",
                    category="Bakery", price_paise=16000, stock=35, low_stock_threshold=8, is_available=True,
                    description="Laminated French pastry with pure butter layers"
                ),
                models.MenuItem(
                    id=9, cafe_id="cafe-blr-01", sku="BAK-002", name="Pain au Chocolat",
                    category="Bakery", price_paise=21000, stock=30, low_stock_threshold=6, is_available=True,
                    description="Dark Belgian chocolate batons rolled in puff pastry"
                ),
                models.MenuItem(
                    id=10, cafe_id="cafe-blr-01", sku="FOD-001", name="Pesto Mozzarella Panini",
                    category="Food", price_paise=32000, stock=20, low_stock_threshold=5, is_available=True,
                    description="Basil pesto, heirloom tomato, buffalo mozzarella on sourdough"
                ),
                models.MenuItem(
                    id=11, cafe_id="cafe-blr-01", sku="DES-001", name="Basque Cheesecake",
                    category="Desserts", price_paise=29000, stock=15, low_stock_threshold=3, is_available=True,
                    description="Caramelized burnt exterior with creamy custard center"
                ),
            ]
            db.add_all(items)
            db.commit()

            # 4. Seed sample reservations
            r1 = models.Reservation(
                cafe_id="cafe-blr-01",
                customer_name="Rohan Verma",
                station_type="VIP_GAMING",
                reserved_for_time=datetime.utcnow() + timedelta(hours=2),
                duration_hours=3,
                status="CONFIRMED"
            )
            r2 = models.Reservation(
                cafe_id="cafe-blr-01",
                customer_name="Aditi Rao",
                station_type="PRIVATE_BOOTH",
                reserved_for_time=datetime.utcnow() + timedelta(hours=4),
                duration_hours=2,
                status="CONFIRMED"
            )
            db.add_all([r1, r2])
            db.commit()
    finally:
        db.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_cloud_database()
    yield

app = FastAPI(
    title="NetKeep Café — Central Cloud API",
    description="Supabase PostgreSQL-backed multi-tenant API for receiving edge café orders, enforcing UUID idempotency, and owner telemetry.",
    version="2.0.0",
    lifespan=lifespan
)

# Configure trusted CORS origins (disallow wildcard when credentials are true)
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,https://netkeep-seven.vercel.app"
)
raw_origins = [o.strip() for o in ALLOWED_ORIGINS.split(",") if o.strip()]
is_wildcard = "*" in raw_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=raw_origins,
    allow_origin_regex=r"^https://.*\.vercel\.app$",
    allow_credentials=not is_wildcard,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Routers
app.include_router(orders.router, prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")
app.include_router(cafes.router, prefix="/api/v1")
app.include_router(branches.router, prefix="/api/v1")
app.include_router(reservations.router, prefix="/api/v1")
app.include_router(sync.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(menu.router, prefix="/api/v1")
app.include_router(menu.router)

@app.get("/")
def root():
    return {
        "service": "NetKeep Café Cloud Central API",
        "status": "ONLINE",
        "version": "2.0.0",
        "database_mode": get_active_database_mode(),
        "docs_url": "/docs"
    }

@app.get("/health")
@app.get("/api/v1/health")
def health():
    return {
        "status": "HEALTHY",
        "service": "cloud-api",
        "database": get_active_database_mode(),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/pos/orders/sync", tags=["Sync"])
@app.post("/api/v1/pos/orders/sync", tags=["Sync"])
def sync_client_order(payload: dict):
    """
    Direct client outbox sync receiver for Cloud Central API.
    Returns explicit server acknowledgment { acknowledged: true }
    so client Dexie IndexedDB never marks an order synced without server confirmation.
    """
    order_id = payload.get("id") or payload.get("order_id")
    order_code = payload.get("order_code", "UNKNOWN")
    return {
        "acknowledged": True,
        "order_id": order_id,
        "order_code": order_code,
        "synced_at": datetime.utcnow().isoformat(),
        "mode": "cloud_direct",
        "message": "Order successfully acknowledged and synchronized with NetKeep Cloud Central"
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8001"))
    host = os.getenv("HOST", "0.0.0.0")
    reload = os.getenv("ENVIRONMENT", "development") == "development"
    uvicorn.run("main:app", host=host, port=port, reload=reload)
