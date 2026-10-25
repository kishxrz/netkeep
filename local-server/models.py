import datetime
import uuid
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from database import Base

class MenuItem(Base):
    __tablename__ = "menu_items"

    id = Column(Integer, primary_key=True, index=True)
    sku = Column(String(32), unique=True, index=True, nullable=False)
    name = Column(String(128), nullable=False)
    category = Column(String(64), index=True, default="Coffee")
    price_paise = Column(Integer, nullable=False) # Integer paise (e.g., ₹180.00 = 18000)
    stock = Column(Integer, default=50, nullable=False)
    low_stock_threshold = Column(Integer, default=10, nullable=False)
    is_available = Column(Boolean, default=True, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

    order_items = relationship("OrderItem", back_populates="menu_item")
    inventory_movements = relationship("InventoryMovement", back_populates="menu_item")

class Order(Base):
    __tablename__ = "orders"

    # Client-generated UUID acting as unique primary key & idempotency token
    id = Column(String(64), primary_key=True, index=True)
    order_code = Column(String(32), unique=True, index=True, nullable=False)
    customer_name = Column(String(128), default="Walk-in Customer", nullable=False)
    payment_method = Column(String(32), default="CASH", nullable=False) # CASH, CARD, UPI
    subtotal_paise = Column(Integer, default=0, nullable=False)
    tax_paise = Column(Integer, default=0, nullable=False)
    discount_paise = Column(Integer, default=0, nullable=False)
    total_paise = Column(Integer, default=0, nullable=False)
    status = Column(String(32), default="PAID", nullable=False) # PAID, CANCELLED, REFUNDED
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    sync_events = relationship("SyncEvent", back_populates="order", cascade="all, delete-orphan")

class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String(64), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    menu_item_id = Column(Integer, ForeignKey("menu_items.id"), nullable=False, index=True)
    item_name = Column(String(128), nullable=False)
    unit_price_paise = Column(Integer, nullable=False)
    quantity = Column(Integer, nullable=False)
    subtotal_paise = Column(Integer, nullable=False)

    order = relationship("Order", back_populates="items")
    menu_item = relationship("MenuItem", back_populates="order_items")

class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    id = Column(Integer, primary_key=True, index=True)
    menu_item_id = Column(Integer, ForeignKey("menu_items.id"), nullable=False, index=True)
    movement_type = Column(String(32), nullable=False) # ORDER_SALE, RESTOCK, ADJUSTMENT, CANCELLATION
    quantity_delta = Column(Integer, nullable=False)    # e.g., -2 for sale, +10 for restock
    stock_before = Column(Integer, nullable=False)
    stock_after = Column(Integer, nullable=False)
    reference_id = Column(String(64), nullable=True, index=True) # References order UUID
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    menu_item = relationship("MenuItem", back_populates="inventory_movements")

class SyncEvent(Base):
    __tablename__ = "sync_events"

    id = Column(Integer, primary_key=True, index=True)
    event_uuid = Column(String(64), unique=True, index=True, default=lambda: str(uuid.uuid4()))
    order_id = Column(String(64), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type = Column(String(64), nullable=False) # ORDER_CREATED, INVENTORY_MOVED, STOCK_RESTOCKED
    payload_json = Column(Text, nullable=False)
    sync_status = Column(String(32), default="PENDING", index=True, nullable=False) # PENDING, SYNCED, FAILED
    retry_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    synced_at = Column(DateTime, nullable=True)

    order = relationship("Order", back_populates="sync_events")
