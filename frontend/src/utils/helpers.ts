/**
 * Shared frontend utility helpers.
 * Wraps API requests, formatting helpers, and operation-path mapping logic.
 */

import { API_BASE, AUTH_INVALID_EVENT } from '../config/constants'
import type { OperationKind } from '../types/models'

export const toOperationKind = (path: string): OperationKind => {
  if (path.includes('receipts')) return 'Receipt'
  if (path.includes('deliveries')) return 'Delivery'
  if (path.includes('transfers')) return 'Internal'
  return 'Adjustment'
}

export const safeNumber = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export const formatDate = (value: string): string => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

export async function apiRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  token?: string,
  payload?: unknown,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  })

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const message = (body as { message?: string } | null)?.message ?? `Request failed (${response.status})`

    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent(AUTH_INVALID_EVENT, { detail: { message } }))
    }

    throw new Error(message)
  }

  return body as T
}
