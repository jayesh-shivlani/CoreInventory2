/**
 * Promise timeout helper.
 * Wraps async operations and rejects when the timeout window is exceeded.
 */

function withTimeout(promise, timeoutMs, timeoutLabel = 'Request timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${timeoutLabel} after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}

module.exports = { withTimeout }
