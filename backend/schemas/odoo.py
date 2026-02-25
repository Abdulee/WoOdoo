"""Odoo XML-RPC API response models"""
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any


class OdooCategory(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    parent_id: Optional[Any] = None  # [id, name] tuple or False


class OdooAttribute(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    value_ids: List[int] = []


class OdooAttributeValue(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    attribute_id: Any  # [id, name]


class OdooAttributeLine(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    attribute_id: Any  # [id, name]
    value_ids: List[int] = []


class OdooProductProduct(BaseModel):
    """Odoo product.product (variant)"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    default_code: Optional[str] = None  # SKU/internal reference
    barcode: Optional[str] = None
    lst_price: float = 0.0
    standard_price: float = 0.0
    qty_available: float = 0.0
    virtual_available: float = 0.0
    combination_indices: Optional[str] = None
    product_template_attribute_value_ids: List[int] = []


class OdooProductTemplate(BaseModel):
    """Odoo product.template (template/configurable product)"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description_sale: Optional[str] = None
    description: Optional[str] = None
    list_price: float = 0.0
    standard_price: float = 0.0
    categ_id: Any = None  # [id, name] or False
    taxes_id: List[int] = []
    attribute_line_ids: List[int] = []
    product_variant_ids: List[int] = []
    product_variant_count: int = 1
    image_1920: Optional[str] = None  # base64
    active: bool = True
    type: str = "consu"  # consu, service, product
    default_code: Optional[str] = None
    barcode: Optional[str] = None
    weight: float = 0.0
    write_date: Optional[str] = None


class OdooPartner(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    street: Optional[str] = None
    city: Optional[str] = None
    zip: Optional[str] = None
    country_id: Any = None  # [id, name]


class OdooSaleOrderLine(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Any  # [id, name]
    product_uom_qty: float
    price_unit: float
    name: str


class OdooSaleOrder(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    partner_id: Any  # [id, name]
    state: str  # draft, sale, done, cancel
    amount_total: float
    order_line: List[int] = []
    date_order: Optional[str] = None
