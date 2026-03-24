/**
 * Promise timeout helper.
 * Wraps async operations and rejects when the timeout window is exceeded.
 */

function withTimeout(promise, timeoutMs, timeoutLabel = 'Request timed out') {
  let timerId
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`${timeoutLabel} after ${timeoutMs}ms`)), timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timerId)
  })
}

module.exports = { withTimeout }
