/**
 * Frontend constants.
 * Defines API endpoints, storage keys, timing intervals, and default options.
 */

export const TOKEN_KEY = 'ims-auth-token'
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '/api').replace(/\/$/, '')
export const LIVE_SYNC_INTERVAL_MS = 8000
export const DEFAULT_UOMS = ['Units', 'Kg', 'L', 'Box', 'Pack', 'Piece']
export const DEFAULT_CATEGORIES = ['Raw Materials', 'Finished Goods', 'Consumables', 'Electronics', 'Hardware']
export const AUTH_INVALID_EVENT = 'ims-auth-invalid'
