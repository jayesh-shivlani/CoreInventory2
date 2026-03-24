import type {
  AnalyticsOverview,
  DashboardFilterResponse,
  KPIResponse,
  LedgerEntry,
  Operation,
  Product,
  ProductFilterOptions,
  Warehouse,
} from '../types/models'

function sameStringArray(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

function sameNumberLike(left: unknown, right: unknown) {
  return Number(left ?? 0) === Number(right ?? 0)
}

export function areKpisEqual(left: KPIResponse, right: KPIResponse) {
  return (
    left.totalProductsInStock === right.totalProductsInStock &&
    left.lowOrOutOfStockItems === right.lowOrOutOfStockItems &&
    left.pendingReceipts === right.pendingReceipts &&
    left.pendingDeliveries === right.pendingDeliveries &&
    left.scheduledInternalTransfers === right.scheduledInternalTransfers
  )
}

export function areDashboardFiltersEqual(left: DashboardFilterResponse, right: DashboardFilterResponse) {
  return (
    sameStringArray(left.documentTypes, right.documentTypes) &&
    sameStringArray(left.statuses, right.statuses) &&
    sameStringArray(left.warehouses, right.warehouses) &&
    sameStringArray(left.categories, right.categories)
  )
}

export function areProductFilterOptionsEqual(left: ProductFilterOptions, right: ProductFilterOptions) {
  return (
    sameStringArray(left.categories, right.categories) &&
    sameStringArray(left.locations, right.locations) &&
    sameStringArray(left.uoms, right.uoms)
  )
}

export function areProductsEqual(left: Product[], right: Product[]) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((product, index) => {
    const other = right[index]
    return (
      product.id === other?.id &&
      product.name === other?.name &&
      product.sku === other?.sku &&
      product.category === other?.category &&
      product.unit_of_measure === other?.unit_of_measure &&
      sameNumberLike(product.reorder_minimum, other?.reorder_minimum) &&
      sameNumberLike(product.availableStock, other?.availableStock) &&
      (product.locationName ?? '') === (other?.locationName ?? '')
    )
  })
}

export function areOperationsEqual(left: Operation[], right: Operation[]) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((operation, index) => {
    const other = right[index]
    return (
      operation.id === other?.id &&
      operation.reference_number === other?.reference_number &&
      operation.type === other?.type &&
      operation.status === other?.status &&
      operation.created_at === other?.created_at &&
      (operation.source_location_name ?? '') === (other?.source_location_name ?? '') &&
      (operation.destination_location_name ?? '') === (other?.destination_location_name ?? '')
    )
  })
}

export function areLedgerEntriesEqual(left: LedgerEntry[], right: LedgerEntry[]) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((entry, index) => {
    const other = right[index]
    return (
      entry.id === other?.id &&
      entry.timestamp === other?.timestamp &&
      entry.product_name === other?.product_name &&
      sameNumberLike(entry.quantity, other?.quantity) &&
      (entry.reference_number ?? '') === (other?.reference_number ?? '') &&
      (entry.operation_type ?? '') === (other?.operation_type ?? '') &&
      (entry.from_location_name ?? '') === (other?.from_location_name ?? '') &&
      (entry.to_location_name ?? '') === (other?.to_location_name ?? '') &&
      (entry.note ?? '') === (other?.note ?? '')
    )
  })
}

export function areWarehousesEqual(left: Warehouse[], right: Warehouse[]) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((warehouse, index) => (
    warehouse.id === right[index]?.id &&
    warehouse.name === right[index]?.name &&
    warehouse.type === right[index]?.type
  ))
}

export function areAnalyticsOverviewsEqual(left: AnalyticsOverview | null, right: AnalyticsOverview | null) {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }

  return JSON.stringify(left) === JSON.stringify(right)
}
