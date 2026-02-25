"""WooCommerce REST API response models"""
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any, Dict


class WCImage(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    src: str
    name: Optional[str] = None
    position: int = 0


class WCAttributeValue(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    name: str
    slug: Optional[str] = None


class WCAttribute(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    name: str
    slug: Optional[str] = None
    type: str = "select"
    order_by: str = "menu_order"
    has_archives: bool = False


class WCCategory(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    name: str
    slug: Optional[str] = None
    parent: int = 0
    description: Optional[str] = None
    count: int = 0


class WCProductAttribute(BaseModel):
    """Attribute as embedded in a WC product"""
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    name: str
    position: int = 0
    visible: bool = True
    variation: bool = False
    options: List[str] = []


class WCVariation(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    sku: Optional[str] = None
    price: Optional[str] = None
    regular_price: Optional[str] = None
    sale_price: Optional[str] = None
    stock_quantity: Optional[int] = None
    stock_status: str = "instock"
    manage_stock: bool = False
    image: Optional[WCImage] = None
    attributes: List[Dict[str, Any]] = []


class WCProduct(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    name: str
    slug: Optional[str] = None
    type: str = "simple"  # simple, variable, grouped, external
    status: str = "publish"
    description: Optional[str] = None
    short_description: Optional[str] = None
    sku: Optional[str] = None
    price: Optional[str] = None
    regular_price: Optional[str] = None
    sale_price: Optional[str] = None
    stock_quantity: Optional[int] = None
    stock_status: str = "instock"
    manage_stock: bool = False
    weight: Optional[str] = None
    categories: List[WCCategory] = []
    images: List[WCImage] = []
    attributes: List[WCProductAttribute] = []
    variations: List[int] = []
    date_modified: Optional[str] = None


class WCOrderLineItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    name: str
    product_id: Optional[int] = None
    variation_id: int = 0
    quantity: int
    subtotal: str
    total: str
    sku: Optional[str] = None


class WCOrder(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    number: Optional[str] = None
    status: str
    currency: str = "USD"
    total: str
    billing: Optional[Dict[str, Any]] = None
    shipping: Optional[Dict[str, Any]] = None
    line_items: List[WCOrderLineItem] = []
    date_created: Optional[str] = None


class WCBatchRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    create: List[Dict[str, Any]] = []
    update: List[Dict[str, Any]] = []
    delete: List[int] = []


class WCBatchResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    create: List[Dict[str, Any]] = []
    update: List[Dict[str, Any]] = []
    delete: List[Dict[str, Any]] = []
