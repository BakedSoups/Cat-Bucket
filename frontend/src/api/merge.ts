import type { CategorizeRequestPayload, CategorizeResponse, DuplicateColumnResponse, MergeResponse, SelectedCsvColumn } from '../types'
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

export async function findDuplicateColumns(columns: SelectedCsvColumn[]) {
  const response = await fetch(`${apiBaseUrl}/api/merge/find-duplicates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ columns }),
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail ?? 'Could not find duplicates.')
  }

  return (await response.json()) as DuplicateColumnResponse
}


export async function categorizeRows(payload: CategorizeRequestPayload) {
  const response = await fetch(`${apiBaseUrl}/api/merge/categorize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail ?? 'Could not categorize rows.')
  }

  return (await response.json()) as CategorizeResponse
}
