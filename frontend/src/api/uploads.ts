import type { CsvDetail, UploadResponse, UploadSummary } from '../types'

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

export async function listCsvUploads() {
  const response = await fetch(`${apiBaseUrl}/api/uploads/csv`)

  if (!response.ok) {
    throw new Error('Could not load CSV uploads.')
  }

  return (await response.json()) as { uploads: UploadSummary[] }
}

export async function getCsvUpload(filename: string) {
  const response = await fetch(
    `${apiBaseUrl}/api/uploads/csv/${encodeURIComponent(filename)}`,
  )

  if (!response.ok) {
    throw new Error('Could not load that CSV.')
  }

  return (await response.json()) as CsvDetail
}

export async function uploadCsv(file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${apiBaseUrl}/api/uploads/csv`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail ?? 'Upload failed.')
  }

  return (await response.json()) as UploadResponse
}
