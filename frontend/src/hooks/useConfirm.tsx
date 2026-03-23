import { useCallback, useRef, useState } from 'react'
import ConfirmModal from '../components/ConfirmModal'

interface ModalState {
  open: boolean
  title: string
  body: string
  danger?: boolean
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
