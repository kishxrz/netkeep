import datetime
import uuid
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, UniqueConstraint, CheckConstraint
)
from sqlalchemy.orm import relationship, synonym
from database import Base

# ==============================================================================
# 1. USERS TABLE (Cafe Owners, Admins, Managers)
# ==============================================================================
class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(128), unique=True, index=True, nullable=False)
    full_name = Column(String(128), nullable=False)
    role = Column(String(32), default="owner", nullable=False)  # 'owner', 'admin', 'manager'
    auth_token = Column(String(128), unique=True, index=True, nullable=False)  # Bearer token for API auth
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

    cafes = relationship("Cafe", back_populates="owner")

# ==============================================================================
# 2. CAFES TABLE (Multi-tenant Café Outlets)
# ==============================================================================
class Cafe(Base):
    __tablename__ = "cafes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cafe_code = Column(String(32), unique=True, index=True, nullable=False)  # e.g. "CAFE-BLR-01"
    name = Column(String(128), nullable=False)
    city = Column(String(64), nullable=False)
    address = Column(String(256), nullable=True)
    phone = Column(String(32), nullable=True)
    owner_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    api_key = Column(String(128), unique=True, index=True, nullable=False)  # Edge server shared secret
    total_stations = Column(Integer, default=16)
    edge_ip = Column(String(45), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    status = Column(String(32), default="ACTIVE")
    last_ping = Column(DateTime, default=datetime.datetime.utcnow)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

    branch_code = synonym("cafe_code")

    owner = relationship("User", back_populates="cafes")
    menu_items = relationship("MenuItem", back_populates="cafe")
    orders = relationship("Order", back_populates="cafe")
    inventory_movements = relationship("InventoryMovement", back_populates="cafe")
    sync_events = relationship("SyncEvent", back_populates="cafe")
    reservations = relationship("Reservation", back_populates="cafe")

# ==============================================================================
# 3. MENU ITEMS TABLE (Integer Paise Prices & Stock)
# ==============================================================================
class MenuItem(Base):
    __tablename__ = "menu_items"

    id = Column(Integer, primary_key=True, index=True)
    cafe_id = Column(String(36), ForeignKey("cafes.id"), nullable=False, index=True)
    sku = Column(String(32), nullable=False, index=True)
    name = Column(String(128), nullable=False)
    category = Column(String(64), nullable=False)
    price_paise = Column(Integer, nullable=False)  # Integer paise: ₹180.00 = 18000
    stock = Column(Integer, default=0, nullable=False)
    low_stock_threshold = Column(Integer, default=5, nullable=False)
    is_available = Column(Boolean, default=True, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

    cafe = relationship("Cafe", back_populates="menu_items")
    order_items = relationship("OrderItem", back_populates="menu_item")
    inventory_movements = relationship("InventoryMovement", back_populates="menu_item")

    __table_args__ = (
        UniqueConstraint("cafe_id", "sku", name="uq_cafe_menu_sku"),
        CheckConstraint("price_paise >= 0", name="chk_price_paise_non_negative"),
    )

# ==============================================================================
# 4. ORDERS TABLE (Strict UUID Idempotency Key & Integer Paise)
# ==============================================================================
class Order(Base):
    __tablename__ = "orders"

    # Client-generated UUIDv4 idempotency key
    id = Column(String(36), primary_key=True, unique=True, index=True, nullable=False)
    cafe_id = Column(String(36), ForeignKey("cafes.id"), nullable=False, index=True)
    order_code = Column(String(32), nullable=False, index=True)
    customer_name = Column(String(128), default="Walk-in Customer", nullable=False)
    payment_method = Column(String(32), default="CASH", nullable=False)  # 'CASH', 'CARD', 'UPI' (Offline)
    subtotal_paise = Column(Integer, nullable=False)
    tax_paise = Column(Integer, nullable=False)
    discount_paise = Column(Integer, default=0, nullable=False)
    total_paise = Column(Integer, nullable=False)
    status = Column(String(32), default="PAID", nullable=False)  # 'PAID', 'CANCELLED', 'REFUNDED'
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False)
    synced_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    cafe = relationship("Cafe", back_populates="orders")
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    inventory_movements = relationship("InventoryMovement", back_populates="order")

# ==============================================================================
# 5. ORDER ITEMS TABLE (Line Items in Integer Paise)
# ==============================================================================
class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String(36), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    menu_item_id = Column(Integer, ForeignKey("menu_items.id"), nullable=False, index=True)
    item_name = Column(String(128), nullable=False)
    unit_price_paise = Column(Integer, nullable=False)
    quantity = Column(Integer, nullable=False)
    subtotal_paise = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    order = relationship("Order", back_populates="items")
    menu_item = relationship("MenuItem", back_populates="order_items")

    __table_args__ = (
        CheckConstraint("quantity > 0", name="chk_order_item_quantity_positive"),
        CheckConstraint("unit_price_paise >= 0", name="chk_order_item_price_non_negative"),
    )

# ==============================================================================
# 6. INVENTORY MOVEMENTS TABLE (Stock Audit Trail)
# ==============================================================================
class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    id = Column(Integer, primary_key=True, index=True)
    cafe_id = Column(String(36), ForeignKey("cafes.id"), nullable=False, index=True)
    menu_item_id = Column(Integer, ForeignKey("menu_items.id"), nullable=False, index=True)
    order_id = Column(String(36), ForeignKey("orders.id"), nullable=True, index=True)
    change_qty = Column(Integer, nullable=False)  # Negative for sales, positive for restock
    reason = Column(String(64), nullable=False)   # 'SALE', 'RESTOCK', 'ADJUSTMENT', 'DAMAGE'
    balance_after = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    cafe = relationship("Cafe", back_populates="inventory_movements")
    menu_item = relationship("MenuItem", back_populates="inventory_movements")
    order = relationship("Order", back_populates="inventory_movements")

# ==============================================================================
# 7. SYNC EVENTS TABLE (Deduplicated Cloud Ingestion Audit)
# ==============================================================================
class SyncEvent(Base):
    __tablename__ = "sync_events"

    id = Column(Integer, primary_key=True, index=True)
    cafe_id = Column(String(36), ForeignKey("cafes.id"), nullable=False, index=True)
    sync_event_id = Column(String(64), unique=True, index=True, nullable=False)
    entity_type = Column(String(64), nullable=False)
    action = Column(String(32), nullable=False)
    payload_json = Column(Text, nullable=False)
    status = Column(String(32), default="PROCESSED", nullable=False)
    ingested_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    cafe = relationship("Cafe", back_populates="sync_events")

# ==============================================================================
# 8. BACKWARD COMPATIBILITY MODELS (Branch, Reservation, CloudUser)
# ==============================================================================
class Reservation(Base):
    __tablename__ = "reservations"

    id = Column(Integer, primary_key=True, index=True)
    reservation_code = Column(String(32), unique=True, index=True, default=lambda: f"RES-{uuid.uuid4().hex[:6].upper()}")
    cafe_id = Column(String(36), ForeignKey("cafes.id"), nullable=True)
    branch_id = synonym("cafe_id")
    customer_name = Column(String(128), nullable=False)
    station_type = Column(String(32), default="VIP_GAMING")
    reserved_for_time = Column(DateTime, nullable=False)
    duration_hours = Column(Integer, default=2)
    status = Column(String(32), default="CONFIRMED")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    cafe = relationship("Cafe", back_populates="reservations")

# Backwards compatible alias for Branch -> Cafe
Branch = Cafe
CloudOrder = Order
IngestedSyncEvent = SyncEvent
