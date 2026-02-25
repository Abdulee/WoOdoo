// WoOdoo API TypeScript interfaces
// Auto-mirrored from backend/schemas/

// ============ Odoo Models ============
export interface OdooCategory {
  id: number;
  name: string;
  parent_id?: [number, string] | false | null;
}

export interface OdooAttribute {
  id: number;
  name: string;
  value_ids: number[];
}

export interface OdooAttributeValue {
  id: number;
  name: string;
  attribute_id: [number, string];
}

export interface OdooProductProduct {
  id: number;
  name: string;
  default_code?: string;
  barcode?: string;
  lst_price: number;
  standard_price: number;
  qty_available: number;
  virtual_available: number;
  combination_indices?: string;
  product_template_attribute_value_ids: number[];
}

export interface OdooProductTemplate {
  id: number;
  name: string;
  description_sale?: string;
  description?: string;
  list_price: number;
  standard_price: number;
  categ_id?: [number, string] | false | null;
  attribute_line_ids: number[];
  product_variant_ids: number[];
  product_variant_count: number;
  image_1920?: string;
  active: boolean;
  type: string;
  default_code?: string;
  barcode?: string;
  weight: number;
  write_date?: string;
}

export interface OdooPartner {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  street?: string;
  city?: string;
  zip?: string;
  country_id?: [number, string] | null;
}

export interface OdooSaleOrderLine {
  id: number;
  product_id: [number, string];
  product_uom_qty: number;
  price_unit: number;
  name: string;
}

export interface OdooSaleOrder {
  id: number;
  name: string;
  partner_id: [number, string];
  state: string;
  amount_total: number;
  order_line: number[];
  date_order?: string;
}

// ============ WooCommerce Models ============
export interface WCImage {
  id?: number;
  src: string;
  name?: string;
  position: number;
}

export interface WCAttribute {
  id?: number;
  name: string;
  slug?: string;
  type: string;
  order_by: string;
  has_archives: boolean;
}

export interface WCAttributeValue {
  id?: number;
  name: string;
  slug?: string;
}

export interface WCCategory {
  id?: number;
  name: string;
  slug?: string;
  parent: number;
  description?: string;
  count: number;
}

export interface WCProductAttribute {
  id?: number;
  name: string;
  position: number;
  visible: boolean;
  variation: boolean;
  options: string[];
}

export interface WCVariation {
  id?: number;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  stock_quantity?: number;
  stock_status: string;
  manage_stock: boolean;
  image?: WCImage;
  attributes: Record<string, unknown>[];
}

export interface WCProduct {
  id?: number;
  name: string;
  slug?: string;
  type: string;
  status: string;
  description?: string;
  short_description?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  stock_quantity?: number;
  stock_status: string;
  manage_stock: boolean;
  weight?: string;
  categories: WCCategory[];
  images: WCImage[];
  attributes: WCProductAttribute[];
  variations: number[];
  date_modified?: string;
}

export interface WCOrderLineItem {
  id?: number;
  name: string;
  product_id?: number;
  variation_id: number;
  quantity: number;
  subtotal: string;
  total: string;
  sku?: string;
}

export interface WCOrder {
  id?: number;
  number?: string;
  status: string;
  currency: string;
  total: string;
  billing?: Record<string, unknown>;
  shipping?: Record<string, unknown>;
  line_items: WCOrderLineItem[];
  date_created?: string;
}

export interface WCBatchRequest {
  create: Record<string, unknown>[];
  update: Record<string, unknown>[];
  delete: number[];
}

export interface WCBatchResponse {
  create: Record<string, unknown>[];
  update: Record<string, unknown>[];
  delete: Record<string, unknown>[];
}

// ============ Connection Models ============
export interface OdooConnectionConfig {
  url: string;
  database: string;
  username: string;
  api_key: string;
}

export interface WooCommerceConnectionConfig {
  url: string;
  consumer_key: string;
  consumer_secret: string;
  version: string;
}

export interface ConnectionCreate {
  platform: 'odoo' | 'woocommerce';
  name: string;
  config: OdooConnectionConfig | WooCommerceConnectionConfig;
}

export interface ConnectionUpdate {
  name?: string;
  config?: OdooConnectionConfig | WooCommerceConnectionConfig;
  is_active?: boolean;
}

export interface ConnectionResponse {
  id: number;
  platform: 'odoo' | 'woocommerce';
  name: string;
  is_active: boolean;
  last_tested_at?: string;
  created_at: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
  currency?: string;
}

// ============ Sync Models ============
export type SyncDirection = 'odoo_to_wc' | 'wc_to_odoo' | 'bidirectional' | 'skip';

export interface FieldMapping {
  field_name: string;
  direction: SyncDirection;
  odoo_field: string;
  wc_field: string;
  transform?: string;
}

export interface FilterConfig {
  category_ids: number[];
  tag_ids: number[];
  only_active: boolean;
  price_min?: number;
  price_max?: number;
  custom_domain?: unknown[];
  wc_status?: string;
}

export interface ScheduleConfig {
  trigger: 'manual' | 'interval' | 'cron';
  interval_minutes?: number;
  cron_expression?: string;
  enabled: boolean;
}

export interface LifecycleConfig {
  on_odoo_create: string;
  on_odoo_delete: string;
  on_wc_create: string;
  on_wc_delete: string;
}

export interface SyncJobCreate {
  name: string;
  direction: SyncDirection;
  filters: FilterConfig;
  field_mappings: FieldMapping[];
  schedule_config: ScheduleConfig;
  lifecycle_config: LifecycleConfig;
  is_enabled: boolean;
  connection_id?: number;
}

export interface SyncJobUpdate {
  name?: string;
  direction?: SyncDirection;
  filters?: FilterConfig;
  field_mappings?: FieldMapping[];
  schedule_config?: ScheduleConfig;
  lifecycle_config?: LifecycleConfig;
  is_enabled?: boolean;
}

export interface SyncJobResponse {
  id: number;
  name: string;
  direction: SyncDirection;
  filters?: FilterConfig;
  field_mappings?: FieldMapping[];
  schedule_config?: ScheduleConfig;
  lifecycle_config?: LifecycleConfig;
  is_enabled: boolean;
  connection_id?: number;
  created_at: string;
  updated_at: string;
}

export interface SyncExecutionResponse {
  id: number;
  job_id: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  completed_at?: string;
  total_products: number;
  synced_count: number;
  error_count: number;
  skipped_count: number;
}

export interface SyncLogResponse {
  id: number;
  execution_id: number;
  product_mapping_id?: number;
  level: 'info' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
  created_at: string;
}

export interface ProductDiffField {
  field: string;
  odoo_value: unknown;
  wc_value: unknown;
  is_different: boolean;
  sync_direction: string;
}

export interface ProductDiff {
  odoo_template_id?: number;
  woo_product_id?: number;
  fields: ProductDiffField[];
  sync_status: string;
  last_synced_at?: string;
}

// ============ WebSocket Models ============
export interface SyncProgressEvent {
  event_type: 'progress' | 'log' | 'completed' | 'error' | 'health';
  execution_id?: number;
  job_id?: number;
  total?: number;
  current?: number;
  synced?: number;
  errors?: number;
  skipped?: number;
  percentage?: number;
  message?: string;
  timestamp: string;
}

export interface LogEntry {
  level: 'info' | 'warning' | 'error';
  message: string;
  product_id?: number;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface ConnectionHealthEvent {
  event_type: 'health';
  platform: string;
  status: 'connected' | 'disconnected' | 'degraded';
  message?: string;
  timestamp: string;
}

// ============ Dashboard / Utility Types ============
export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  celery: 'workers_active' | 'no_workers';
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface ApiError {
  detail: string;
  status_code?: number;
}
