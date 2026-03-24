export default function PageLoadingState() {
  return (
    <div className="page-loading-state" role="status" aria-live="polite">
      <div className="page-loading-spinner" aria-hidden="true" />
      <div>
        <strong>Loading workspace</strong>
        <p>Preparing the next screen.</p>
      </div>
    </div>
  )
}
