export type KPIResponse = {
  totalProductsInStock: number
  lowOrOutOfStockItems: number
  pendingReceipts: number
  pendingDeliveries: number
  scheduledInternalTransfers: number
}

export type DashboardFilterResponse = {
  documentTypes: string[]
  statuses: string[]
  warehouses: string[]
  categories: string[]
}

export type ProductFilterOptions = {
  categories: string[]
  locations: string[]
  uoms: string[]
}

export type Product = {
  id: number
  name: string
  sku: string
  category: string
  unit_of_measure: string
  reorder_minimum?: number
  availableStock?: number
  locationName?: string
}

export type OperationKind = 'Receipt' | 'Delivery' | 'Internal' | 'Adjustment'

export type Operation = {
  id: number
  reference_number: string
  type: OperationKind
  status: 'Draft' | 'Waiting' | 'Ready' | 'Done' | 'Canceled'
  source_location_name?: string
  destination_location_name?: string
  created_at: string
}

export type LedgerEntry = {
  id: number
  timestamp: string
  product_name: string
  from_location_name?: string
  to_location_name?: string
  quantity: number
  reference_number?: string
  operation_type?: string
  note?: string
}

export type Warehouse = {
  id: number
  name: string
  type: string
}

export type UserProfile = {
  id: number
  name: string
  email: string
  role: string
}

export type AdminRoleRequest = {
  id: number
  name: string
  email: string
  requested_role: string
  status: string
  created_at: string
  reviewed_at?: string
  review_note?: string
  reviewed_by_name?: string
}

export type UserRoleRequestStatus = {
  status: 'not_requested' | 'pending' | 'rejected' | 'revoked' | 'completed'
  requested_role: string | null
  requested_at: string | null
  reviewed_at: string | null
  review_note: string | null
}

export type AdminManagedUser = {
  id: number
  name: string
  email: string
  role: string
}

export type RoleAuditEntry = {
  id: number
  action: string
  target_user_id: number | null
  target_user_email: string | null
  old_role: string | null
  new_role: string | null
  performed_by_id: number | null
  performed_by_email: string | null
  note: string | null
  created_at: string
}

export type NotificationItem = {
  id: string
  kind: 'success' | 'warning' | 'error' | 'info'
  title: string
  message: string
  link: string
}

export type Toast = {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
}

export type OperationDraftLine = {
  product_id: string
  requested_quantity: string
  picked_quantity?: string
  packed_quantity?: string
}

export type ProductStockRow = {
  location_id: number
  location_name: string
  quantity: number
}

export type WarehouseInventoryRow = {
  product_id: number
  product_name: string
  sku: string
  unit_of_measure: string
  quantity: number
}

export type AnalyticsOverview = {
  dailyMovements: Array<{
    date: string
    full_date: string
    movements: number
    total_quantity: number
  }>
  categoryBreakdown: Array<{
    category: string
    product_count: number
    total_stock: number
  }>
  topProducts: Array<{
    id: number
    name: string
    sku: string
    category: string
    unit_of_measure: string
    reorder_minimum: number
    total_stock: number
  }>
  operationStats: Array<{
    type: string
    total: number
    done_count: number
  }>
  reorderSuggestions: Array<{
    id: number
    name: string
    sku: string
    category: string
    reorder_minimum: number
    current_stock: number
  }>
  locationStock: Array<{
    location_name: string
    location_type: string
    product_count: number
    total_stock: number
  }>
  totalMovements: number
}
