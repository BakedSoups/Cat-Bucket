export type View =
  | { name: 'dashboard' }
  | { name: 'uploads' }
  | { name: 'csv-detail'; filename: string }
  | { name: 'merge'; filenames: string[] }
  | { name: 'analysis' }

export type UploadState = 'idle' | 'uploading' | 'success' | 'error'
export type LoadState = 'idle' | 'loading' | 'error'

export type UploadSummary = {
  filename: string
  rows: number
  columns: string[]
  size: number
  modified_at: number
}

export type UploadResponse = {
  filename: string
  rows: number
  columns: string[]
}

export type CsvDetail = {
  filename: string
  rows: Record<string, string>[]
  row_count: number
  columns: string[]
}

export type MergeResponse = {
  files: CsvDetail[]
  selected_filenames: string[]
}

export type SelectedCsvColumn = {
  filename: string
  column: string
  values: string[]
}

export type DuplicateColumnResponse = {
  sources: SelectedCsvColumn[]
  matches: Array<{
    filename: string
    column: string
    duplicateValues: string[]
    duplicateCount: number
    matchedSources: Array<{
      filename: string
      column: string
    }>
  }>
}

