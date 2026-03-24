import { useEffect, useState } from 'react'

/**
 * Returns a debounced copy of `value` so expensive work runs after input settles.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value)
    }, delayMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [delayMs, value])

  return debouncedValue
}
