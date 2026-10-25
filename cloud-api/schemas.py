from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

# ==============================================================================
# 1. USER SCHEMAS
# ==============================================================================
class UserBase(BaseModel):
    email: str
    full_name: str
    role: str = "owner"

class UserCreate(UserBase):
    auth_token: Optional[str] = None

class UserResponse(UserBase):
    id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

# ==============================================================================
# 2. CAFE SCHEMAS
# ==============================================================================
class CafeBase(BaseModel):
    cafe_code: str
    name: str
    city: str
    address: Optional[str] = None
    phone: Optional[str] = None
    total_stations: int = 16
    edge_ip: Optional[str] = None

class CafeCreate(CafeBase):
    owner_id: str
    api_key: Optional[str] = None

class CafeResponse(CafeBase):
    id: str
    owner_id: str
    is_active: bool
    last_ping: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

# ==============================================================================
# 3. MENU ITEM SCHEMAS (Integer Paise)
# ==============================================================================
class MenuItemBase(BaseModel):
    sku: str
    name: str
    category: str
    price_paise: int = Field(..., ge=0, description="Price in integer paise (e.g. 18000 = ₹180.00)")
    stock: int = Field(default=0, ge=0)
    low_stock_threshold: int = Field(default=5, ge=0)
    is_available: bool = True
    description: Optional[str] = None

class MenuItemCreate(MenuItemBase):
    pass

class MenuItemResponse(MenuItemBase):
    id: int
    cafe_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

# ==============================================================================
# 4. ORDER & LINE ITEM SCHEMAS (Offline POS & UUID Idempotency)
# ==============================================================================
class OrderItemCreate(BaseModel):
    menu_item_id: int
    quantity: int = Field(..., gt=0)
    item_name: Optional[str] = None
    unit_price_paise: Optional[int] = Field(None, ge=0)

class OrderItemResponse(BaseModel):
    id: int
    menu_item_id: int
    item_name: str
    unit_price_paise: int
    quantity: int
    subtotal_paise: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class OrderCreateRequest(BaseModel):
    id: str = Field(..., description="Stable client UUIDv4 idempotency key")
    order_code: str
    customer_name: str = "Walk-in Customer"
    payment_method: str = Field("CASH", description="Offline payment mode: CASH, CARD, or UPI")
    discount_paise: int = Field(default=0, ge=0)
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    items: List[OrderItemCreate] = Field(..., min_length=1)

class OrderResponse(BaseModel):
    id: str
    cafe_id: str
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
    synced_at: datetime
    items: List[OrderItemResponse] = []
    is_idempotent_replay: Optional[bool] = False

    model_config = ConfigDict(from_attributes=True)

# ==============================================================================
# 5. INVENTORY MOVEMENT SCHEMAS
# ==============================================================================
class InventoryMovementResponse(BaseModel):
    id: int
    cafe_id: str
    menu_item_id: int
    order_id: Optional[str] = None
    change_qty: int
    reason: str
    balance_after: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

# ==============================================================================
# 6. SYNC BATCH SCHEMAS
# ==============================================================================
class SyncEventIn(BaseModel):
    sync_event_id: str
    branch_id: Optional[str] = None
    cafe_id: Optional[str] = None
    entity_type: str
    action: str
    payload: Dict[str, Any]
    created_at: Optional[str] = None

class SyncBatchRequest(BaseModel):
    cafe_id: Optional[str] = None
    branch_id: Optional[str] = None
    events: List[SyncEventIn]

class SyncBatchResponse(BaseModel):
    cafe_id: str
    processed_count: int
    skipped_duplicates: int
    status: str

# ==============================================================================
# 7. OWNER DASHBOARD SCHEMAS
# ==============================================================================
class LowStockAlert(BaseModel):
    menu_item_id: int
    cafe_id: str
    cafe_name: str
    name: str
    sku: str
    stock: int
    low_stock_threshold: int

class TopSellingItem(BaseModel):
    menu_item_id: int
    name: str
    category: str
    total_quantity_sold: int
    total_revenue_paise: int

class CafeOverview(BaseModel):
    id: str
    cafe_code: str
    name: str
    city: str
    total_stations: int
    today_orders_count: int
    today_revenue_paise: int
    today_revenue_inr: str
    is_active: bool

class OwnerDashboardResponse(BaseModel):
    owner_id: str
    owner_name: str
    total_cafes: int
    total_revenue_paise: int
    total_revenue_inr: str
    total_orders_count: int
    today_orders_count: int
    today_revenue_paise: int
    today_revenue_inr: str
    low_stock_count: int
    low_stock_alerts: List[LowStockAlert]
    top_selling_items: List[TopSellingItem]
    recent_orders: List[OrderResponse]
    cafes: List[CafeOverview]
    server_time: datetime

# ==============================================================================
# 8. RESERVATIONS & CLOUD OVERVIEW SCHEMAS (Legacy Compatibility)
# ==============================================================================
class ReservationCreate(BaseModel):
    branch_code: str
    customer_name: str
    user_id: Optional[int] = None
    station_type: str = "VIP_GAMING"
    reserved_for_time: datetime
    duration_hours: int = 2

class ReservationResponse(BaseModel):
    id: int
    reservation_code: str
    branch_id: Optional[str] = None
    cafe_id: Optional[str] = None
    customer_name: str
    station_type: str
    reserved_for_time: datetime
    duration_hours: int
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class CloudAnalyticsResponse(BaseModel):
    total_branches: int
    active_branches: int
    total_network_stations: int
    network_revenue_today: float
    total_ingested_events: int
    active_reservations: int
    cloud_time: datetime

# Backwards compatible aliases
BranchBase = CafeBase
BranchCreate = CafeCreate
BranchResponse = CafeResponse
