import type { MergeResponse } from '../types'
import { apiBaseUrl } from './uploads'

export async function mergeCsvUploads(filenames: string[]) {
  const response = await fetch(`${apiBaseUrl}/api/merge/csv`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filenames }),
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail ?? 'Could not start merge.')
  }

  return (await response.json()) as MergeResponse
}
