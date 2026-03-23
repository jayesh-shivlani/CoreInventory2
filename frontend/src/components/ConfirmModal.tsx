/**
 * ConfirmModal - replaces every window.confirm() call in the app.
 */

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
            autoFocus
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmModal
