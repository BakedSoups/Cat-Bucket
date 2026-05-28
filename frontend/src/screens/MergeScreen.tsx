import { useEffect, useRef, useState } from 'react'
import { findDuplicateColumns, mergeCsvUploads } from '../api/merge'
import type {
  CsvDetail,
  DuplicateColumnResponse,
  LoadState,
  MergeResponse,
  SelectedCsvColumn,
  TagOccurrence,
  UnificationCandidate,
} from '../types'

type MergeScreenProps = {
  filenames: string[]
  onBack: () => void
}

type HoveredColumn = {
  filename: string
  column: string
}

const OCCURRENCE_PREVIEW_LIMIT = 6

export function MergeScreen({ filenames, onBack }: MergeScreenProps) {
  const [mergeState, setMergeState] = useState<LoadState>('loading')
  const [mergeResult, setMergeResult] = useState<MergeResponse | null>(null)
  const [selectedColumns, setSelectedColumns] = useState<SelectedCsvColumn[]>([])
  const [duplicateResult, setDuplicateResult] = useState<DuplicateColumnResponse | null>(null)
  const [duplicateState, setDuplicateState] = useState<LoadState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [hoveredColumn, setHoveredColumn] = useState<HoveredColumn | null>(null)
  const [focusedCellKeys, setFocusedCellKeys] = useState<string[]>([])
  const cellRefs = useRef<Record<string, HTMLTableCellElement | null>>({})

  useEffect(() => {
    async function startMerge() {
      setMergeState('loading')
      setErrorMessage('')
      setSelectedColumns([])
      setDuplicateResult(null)
      setHoveredColumn(null)
      setFocusedCellKeys([])
      cellRefs.current = {}

      try {
        const data = await mergeCsvUploads(filenames)
        setMergeResult(data)
        setMergeState('idle')
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Could not start merge.')
        setMergeState('error')
      }
    }

    void startMerge()
  }, [filenames])

  function getCellKey(filename: string, column: string, rowIndex: number) {
    return `${filename}::${column}::${rowIndex}`
  }

  function getOccurrenceKey(occurrence: TagOccurrence) {
    return getCellKey(occurrence.filename, occurrence.column, occurrence.rowIndex)
  }

  function isColumnHovered(file: CsvDetail, column: string) {
    return hoveredColumn?.filename === file.filename && hoveredColumn.column === column
  }

  function isColumnSelected(file: CsvDetail, column: string) {
    return selectedColumns.some(
      (selected) => selected.filename === file.filename && selected.column === column,
    )
  }

  function isCellFocused(file: CsvDetail, column: string, rowIndex: number) {
    return focusedCellKeys.includes(getCellKey(file.filename, column, rowIndex))
  }

  function getColumnClassName(isHovered: boolean, isSelected: boolean, isFocused = false) {
    return [
      isHovered ? 'hovered-column' : '',
      isSelected ? 'selected-column-cell' : '',
      isFocused ? 'focused-match-cell' : '',
    ]
      .filter(Boolean)
      .join(' ')
  }

  function toggleColumn(file: CsvDetail, column: string) {
    setDuplicateResult(null)
    setFocusedCellKeys([])
    setSelectedColumns((current) => {
      const exists = current.some(
        (selected) => selected.filename === file.filename && selected.column === column,
      )

      if (exists) {
        return current.filter(
          (selected) => selected.filename !== file.filename || selected.column !== column,
        )
      }

      return [
        ...current,
        {
          filename: file.filename,
          column,
          values: file.rows.map((row) => row[column] ?? ''),
        },
      ]
    })
  }

  function formatOccurrenceLocation(occurrence: TagOccurrence) {
    return `${occurrence.filename} / ${occurrence.column} / row ${occurrence.rowIndex + 1}`
  }

  function focusOccurrences(occurrences: TagOccurrence[]) {
    const keys = occurrences.map(getOccurrenceKey)
    setFocusedCellKeys(keys)

    const firstCell = cellRefs.current[keys[0]]
    firstCell?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  }

  function getCandidateOccurrences(candidate: UnificationCandidate) {
    return [
      ...candidate.exactOccurrences,
      ...candidate.fuzzyOccurrences,
      ...candidate.llmOccurrences,
    ]
  }

  function renderOccurrencePreview(occurrences: TagOccurrence[]) {
    const visibleOccurrences = occurrences.slice(0, OCCURRENCE_PREVIEW_LIMIT)
    const remainingCount = occurrences.length - visibleOccurrences.length

    return (
      <ul className="occurrence-list">
        {visibleOccurrences.map((occurrence) => (
          <li key={`${getOccurrenceKey(occurrence)}-${occurrence.value}`}>
            <button type="button" onClick={() => focusOccurrences([occurrence])}>
              <span>{occurrence.value}</span>
              <small>{formatOccurrenceLocation(occurrence)}</small>
            </button>
          </li>
        ))}
        {remainingCount > 0 && (
          <li>
            <span>{remainingCount} more occurrence{remainingCount === 1 ? '' : 's'}</span>
            <small>Use focus matches to highlight the full set</small>
          </li>
        )}
      </ul>
    )
  }

  async function handleFindDuplicates() {
    if (selectedColumns.length === 0) return

    setDuplicateState('loading')
    setErrorMessage('')
    setFocusedCellKeys([])

    try {
      const data = await findDuplicateColumns(selectedColumns)
      setDuplicateResult(data)
      setDuplicateState('idle')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not find duplicates.')
      setDuplicateState('error')
    }
  }

  return (
    <section className="csv-preview">
      <div className="panel-heading">
        <div>
          <button className="text-button" type="button" onClick={onBack}>
            Back to documents
          </button>
          <h2>Merge CSVs</h2>
          <p>{filenames.length} selected files sent to FastAPI.</p>
        </div>
      </div>

      {mergeState === 'loading' && <p className="muted">Loading sheet previews...</p>}
      {(mergeState === 'error' || duplicateState === 'error') && (
        <p className="status error">{errorMessage}</p>
      )}

      {mergeResult && mergeState !== 'loading' && (
        <>
          <div className="merge-toolbar">
            <button
              className="primary-button"
              type="button"
              disabled={selectedColumns.length === 0 || duplicateState === 'loading'}
              onClick={handleFindDuplicates}
            >
              {duplicateState === 'loading' ? 'Finding...' : 'Find unification candidates'}
            </button>
            <span className="muted">
              {selectedColumns.length} selected column{selectedColumns.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="sheet-preview-grid">
            {mergeResult.files.map((file) => {
              const visibleColumns = file.columns

              return (
                <section className="sheet-preview" key={file.filename}>
                  <div className="sheet-preview-heading">
                    <h3>{file.filename}</h3>
                    <span className="muted">
                      {file.row_count} rows, {file.columns.length} columns
                    </span>
                  </div>

                  <div className="sheet-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          {visibleColumns.map((column) => {
                            const isSelected = isColumnSelected(file, column)
                            const isHovered = isColumnHovered(file, column)

                            return (
                              <th
                                className={getColumnClassName(isHovered, isSelected)}
                                key={column}
                                onMouseEnter={() =>
                                  setHoveredColumn({ filename: file.filename, column })
                                }
                                onMouseLeave={() => setHoveredColumn(null)}
                              >
                                <button
                                  className={
                                    isSelected
                                      ? 'column-select selected-column'
                                      : 'column-select'
                                  }
                                  type="button"
                                  onClick={() => toggleColumn(file, column)}
                                >
                                  {column}
                                </button>
                              </th>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {file.rows.map((row, rowIndex) => (
                          <tr key={`${file.filename}-${rowIndex}`}>
                            {visibleColumns.map((column) => {
                              const isSelected = isColumnSelected(file, column)
                              const isHovered = isColumnHovered(file, column)
                              const isFocused = isCellFocused(file, column, rowIndex)
                              const cellKey = getCellKey(file.filename, column, rowIndex)

                              return (
                                <td
                                  className={getColumnClassName(isHovered, isSelected, isFocused)}
                                  key={column}
                                  ref={(element) => {
                                    cellRefs.current[cellKey] = element
                                  }}
                                  onMouseEnter={() =>
                                    setHoveredColumn({ filename: file.filename, column })
                                  }
                                  onMouseLeave={() => setHoveredColumn(null)}
                                >
                                  {row[column]}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )
            })}
          </div>

          {duplicateResult && (
            <section className="duplicate-results">
              <div className="duplicate-results-heading">
                <div>
                  <h3>Unification candidates</h3>
                  <p className="muted">
                    {duplicateResult.summary.tagCount} entries scanned across{' '}
                    {duplicateResult.summary.uniqueTagCount} unique values.
                  </p>
                </div>
                <span>
                  {duplicateResult.unificationCandidates.length} candidates
                </span>
              </div>

              {duplicateResult.unificationCandidates.length === 0 && (
                <p className="muted">No unification candidates found.</p>
              )}

              {duplicateResult.unificationCandidates.map((candidate) => {
                const occurrences = getCandidateOccurrences(candidate)

                return (
                  <article key={`${candidate.canonicalTag}-${candidate.values.join('|')}`}>
                    <div className="duplicate-result-body">
                      <div className="candidate-heading-row">
                        <div>
                          <strong>{candidate.canonicalTag}</strong>
                          <p className="muted">{candidate.values.join(', ')}</p>
                        </div>
                        <button
                          className="secondary-button compact-button"
                          type="button"
                          onClick={() => focusOccurrences(occurrences)}
                        >
                          Focus matches
                        </button>
                      </div>

                      <div className="candidate-counts" aria-label="Match counts">
                        <span>{candidate.exactMatchCount} exact</span>
                        <span>{candidate.fuzzyMatchCount} fuzzy</span>
                        <span>{candidate.llmMatchCount} LLM</span>
                      </div>

                      {candidate.llmStatus !== 'ready' && (
                        <p className="muted">Offline LLM review is not configured yet.</p>
                      )}

                      {renderOccurrencePreview(occurrences)}
                    </div>
                    <span>
                      {candidate.totalMatchCount} match{candidate.totalMatchCount === 1 ? '' : 'es'}
                    </span>
                  </article>
                )
              })}

              {duplicateResult.selectedColumnValues.length > 0 && (
                <div className="selected-source-summary">
                  <strong>Selected source columns</strong>
                  <div>
                    {duplicateResult.selectedColumnValues.map((source) => (
                      <span key={`${source.filename}-${source.column}`}>
                        {source.filename} / {source.column} ({source.values.length} rows)
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </section>
  )
}
