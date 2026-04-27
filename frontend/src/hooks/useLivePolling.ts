import { useEffect, useRef } from 'react'

type UseLivePollingOptions = {
  enabled?: boolean
  immediate?: boolean
  intervalMs: number
  runWhenHidden?: boolean
  backoffOnError?: boolean
  maxIntervalMs?: number
}

/**
 * Polls an async task on an interval while preventing overlapping executions.
 */
export function useLivePolling(
  task: () => Promise<void> | void,
  {
    enabled = true,
    immediate = true,
    intervalMs,
    runWhenHidden = false,
    backoffOnError = false,
    maxIntervalMs,
  }: UseLivePollingOptions,
) {
  const taskRef = useRef(task)

  useEffect(() => {
    taskRef.current = task
  }, [task])

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false
    let running = false
    let timeoutId: number | null = null
    let failureCount = 0

    const getDelayMs = () => {
      if (!backoffOnError) {
        return intervalMs
      }
      const exponential = intervalMs * (2 ** failureCount)
      const upperBound = Math.max(intervalMs, maxIntervalMs ?? intervalMs * 8)
      return Math.min(exponential, upperBound)
    }

    const scheduleNext = () => {
      if (cancelled) {
        return
      }
      const delayMs = getDelayMs()
      timeoutId = window.setTimeout(() => {
        void execute()
      }, delayMs)
    }

    const execute = async () => {
      if (cancelled || running) {
        return
      }
      if (!runWhenHidden && document.visibilityState === 'hidden') {
        return
      }

      running = true
      try {
        await taskRef.current()
        failureCount = 0
      } catch {
        if (backoffOnError) {
          failureCount += 1
        }
      } finally {
        running = false
        scheduleNext()
      }
    }

    if (immediate) {
      void execute()
    } else {
      scheduleNext()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void execute()
      }
    }

    if (!runWhenHidden) {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      cancelled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      if (!runWhenHidden) {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }
  }, [enabled, immediate, intervalMs, runWhenHidden, backoffOnError, maxIntervalMs])
}
