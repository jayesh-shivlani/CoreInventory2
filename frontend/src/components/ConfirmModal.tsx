/**
 * ConfirmModal - replaces every window.confirm() call in the app.
 *
 * Usage:
 *   const { modal, confirm } = useConfirm()
 *   ...
 *   const ok = await confirm('Delete this product?', 'This cannot be undone.')
 *   if (ok) { ... }
 *   ...
 *   return <>{modal}</>
 */

import { useCallback, useRef, useState } from 'react'

interface ModalState {
  open:    boolean
  title:   string
  body:    string
  danger?: boolean
}

interface ConfirmModalProps extends ModalState {
  onConfirm: () => void
  onCancel:  () => void
}

function ConfirmModal({ open, title, body, danger, onConfirm, onCancel }: ConfirmModalProps) {
  if (!open) return null
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-card">
        <h3 className="modal-title" id="modal-title">{title}</h3>
        {body && <p className="modal-body">{body}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Returns `{ modal, confirm }`.
 *
 * - `modal`   - JSX to render (place once at the root of your component).
 * - `confirm` - async function that resolves to `true` / `false`.
 */
export function useConfirm() {
  const [state, setState] = useState<ModalState>({
    open: false, title: '', body: '',
  })
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback(
    (title: string, body = '', danger = true): Promise<boolean> => {
      setState({ open: true, title, body, danger })
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve
      })
    },
    [],
  )

  const handleConfirm = useCallback(() => {
    setState((s) => ({ ...s, open: false }))
    resolverRef.current?.(true)
  }, [])

  const handleCancel = useCallback(() => {
    setState((s) => ({ ...s, open: false }))
    resolverRef.current?.(false)
  }, [])

  const modal = (
    <ConfirmModal
      {...state}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )

  return { modal, confirm }
}

export default ConfirmModal
