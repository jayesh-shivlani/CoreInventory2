/**
 * Plays a short notification "ting" using the Web Audio API.
 * Silently does nothing when the browser blocks audio (autoplay policy).
 */
export function playNotificationTing(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return

    const ctx        = new AudioCtx()
    const oscillator = ctx.createOscillator()
    const gainNode   = ctx.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(1100, ctx.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(1450, ctx.currentTime + 0.08)

    gainNode.gain.setValueAtTime(0.0001, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.2)
    oscillator.onended = () => { void ctx.close().catch(() => undefined) }
  } catch {
    // Silently swallow audio errors - notifications must never block the UI.
  }
}
