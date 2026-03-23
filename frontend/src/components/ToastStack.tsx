/**
 * Toast stack renderer.
 * Shows transient feedback messages in a consistent visual style.
 */

import type { Toast } from '../types/models'

interface Props {
  toasts: Toast[]
}

export default function ToastStack({ toasts }: Props) {
  if (!toasts.length) return null
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          {toast.text}
        </div>
      ))}
    </div>
  )
}
