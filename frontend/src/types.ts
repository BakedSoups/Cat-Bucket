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

export type TagOccurrence = {
  filename: string
  column: string
  rowIndex: number
  value: string
}

export type DuplicateTagGroup = {
  canonicalTag: string
  normalizedTag: string
  values: string[]
  duplicateCount: number
  occurrences: TagOccurrence[]
}

export type FuzzyTagGroup = {
  suggestedTag: string
  values: string[]
  score: number
  occurrenceCount: number
  occurrences: TagOccurrence[]
}

export type UnificationCandidate = {
  canonicalTag: string
  values: string[]
  exactMatchCount: number
  fuzzyMatchCount: number
  llmMatchCount: number
  totalMatchCount: number
  score: number
  llmStatus: string
  exactOccurrences: TagOccurrence[]
  fuzzyOccurrences: TagOccurrence[]
  llmOccurrences: TagOccurrence[]
}

export type DuplicateColumnResponse = {
  sources: SelectedCsvColumn[]
  selectedColumnValues: SelectedCsvColumn[]
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
  duplicateTagGroups: DuplicateTagGroup[]
  fuzzyTagGroups: FuzzyTagGroup[]
  unificationCandidates: UnificationCandidate[]
  summary: {
    tagCount: number
    uniqueTagCount: number
    duplicateGroupCount: number
    fuzzyGroupCount: number
    fuzzyPreviewLimit: number
    llmCandidateCount: number
    llmMatchCount: number
    llmStatus: string
  }
}


export type CategorizeRequestPayload = {
  categoryColumn: SelectedCsvColumn
  targetColumn: SelectedCsvColumn
  contextColumns: SelectedCsvColumn[]
}

export type CategorySuggestion = {
  filename: string
  rowIndex: number
  targetValue: string
  context: Record<string, string>
  suggestedCategory: string
  confidence: number
  reason: string
  method: string
}

export type CategorizeResponse = {
  categoryColumn: SelectedCsvColumn
  targetColumn: SelectedCsvColumn
  contextColumns: SelectedCsvColumn[]
  categories: string[]
  suggestions: CategorySuggestion[]
  questions: string[]
  summary: {
    categoryCount: number
    rowCount: number
    suggestionCount: number
    llmStatus: string
    ollamaModel: string
  }
}

export type CsvCellUpdate = {
  filename: string
  column: string
  rowIndex: number
  value: string
  originalValue?: string
}

export type SaveMergeChangesPayload = {
  updates: CsvCellUpdate[]
}
