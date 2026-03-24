import { useEffect, useRef } from 'react'

type UseLivePollingOptions = {
  enabled?: boolean
  immediate?: boolean
  intervalMs: number
  runWhenHidden?: boolean
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
      } finally {
        running = false
      }
    }

    if (immediate) {
      void execute()
    }

    const intervalId = window.setInterval(() => {
      void execute()
    }, intervalMs)

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
      window.clearInterval(intervalId)
      if (!runWhenHidden) {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }
  }, [enabled, immediate, intervalMs, runWhenHidden])
}
