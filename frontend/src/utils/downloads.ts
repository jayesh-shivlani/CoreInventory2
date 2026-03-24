import { API_BASE } from '../config/constants'
import type { Toast } from '../types/models'

/**
 * Downloads a file from an authenticated API route without leaving the current page.
 */
export async function downloadFileFromApi(
  path: string,
  filename: string,
  token: string | null,
  pushToast: (kind: Toast['kind'], text: string) => void,
) {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })

    if (!response.ok) {
      throw new Error('Export failed')
    }

    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = objectUrl
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(objectUrl)

    pushToast('success', `${filename} downloaded`)
  } catch {
    pushToast('error', 'Export failed. Please try again.')
  }
}
