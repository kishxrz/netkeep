from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Literal
from uuid import UUID
from datetime import datetime

# ==========================================
# HEALTH & METRICS SCHEMAS
# ==========================================
class HealthResponse(BaseModel):
    status: str = "HEALTHY"
    service: str = "local-server"
    mode: str = "offline-first"
    branch_id: str
    database: str
    timestamp: datetime

# ==========================================
# MENU ITEM SCHEMAS
# ==========================================
class MenuItemBase(BaseModel):
    sku: str = Field(min_length=3, max_length=32)
    name: str = Field(min_length=2, max_length=128)
    category: str = Field(default="Coffee", max_length=64)
    price_paise: int = Field(gt=0, description="Price in integer paise (e.g., 18000 for ₹180.00)")
    stock: int = Field(ge=0, description="Current stock quantity")
    low_stock_threshold: int = Field(default=10, ge=0)
    is_available: bool = True
    description: Optional[str] = None

class MenuItemCreate(MenuItemBase):
    pass

class MenuItemResponse(MenuItemBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

# ==========================================
# ORDER & LINE ITEM SCHEMAS
# ==========================================
class OrderItemCreate(BaseModel):
    menu_item_id: int = Field(gt=0, description="ID of the menu item")
    quantity: int = Field(gt=0, description="Quantity to order, must be 1 or greater")

class OrderCreate(BaseModel):
    # Client-generated UUID for strict idempotency
    id: UUID = Field(description="Client-generated unique UUID idempotency token")
    order_code: Optional[str] = Field(default=None, max_length=32, description="Optional human-friendly code")
    customer_name: str = Field(default="Walk-in Customer", max_length=128)
    payment_method: Literal["CASH", "CARD", "UPI"] = "CASH"
    discount_paise: int = Field(default=0, ge=0, description="Discount in integer paise")
    notes: Optional[str] = None
    items: List[OrderItemCreate] = Field(min_length=1, description="Order must contain at least 1 item")

class OrderItemResponse(BaseModel):
    id: int
    order_id: str
    menu_item_id: int
    item_name: str
    unit_price_paise: int
    quantity: int
    subtotal_paise: int

    model_config = ConfigDict(from_attributes=True)

class OrderResponse(BaseModel):
    id: str
    order_code: str
    customer_name: str
    payment_method: str
    subtotal_paise: int
    tax_paise: int
    discount_paise: int
    total_paise: int
    status: str
    notes: Optional[str] = None
    created_at: datetime
    items: List[OrderItemResponse] = []
    
    # Metadata flag indicating if this was an idempotent replay of an existing order
    is_idempotent_replay: bool = False

    model_config = ConfigDict(from_attributes=True)

# ==========================================
# INVENTORY MOVEMENT SCHEMAS
# ==========================================
class InventoryMovementResponse(BaseModel):
    id: int
    menu_item_id: int
    movement_type: str
    quantity_delta: int
    stock_before: int
    stock_after: int
    reference_id: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

# ==========================================
# SYNC STATUS SCHEMAS
# ==========================================
class SyncStatusResponse(BaseModel):
    pending_sync_events: int
    synced_events: int
    total_orders_recorded: int
    cloud_endpoint: str
    branch_id: str
    server_time: datetime
