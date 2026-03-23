/** Animated "Updating..." chip shown while data is refreshing in the background. */
export default function SyncStatusChip({
  show,
  label = 'Updating...',
}: {
  show: boolean
  label?: string
}) {
  if (!show) return null
  return (
    <span className="sync-status-chip" role="status" aria-live="polite">
      <span className="sync-status-dot" aria-hidden="true" />
      {label}
    </span>
  )
}
