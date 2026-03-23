import { API_BASE } from '../config/constants'
import type { Toast } from '../types/models'

export async function downloadCSV(
  path: string,
  filename: string,
  token: string | null,
  pushToast: (kind: Toast['kind'], text: string) => void,
) {
  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: token ? `Bearer ${token}` : '' },
    })
    if (!resp.ok) throw new Error('Export failed')
    const blob = await resp.blob()
    // Trigger a browser download without navigating away from the current page.
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    pushToast('success', `${filename} downloaded`)
  } catch {
    pushToast('error', 'Export failed - please try again.')
  }
}
