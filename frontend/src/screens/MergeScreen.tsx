import { useEffect, useRef, useState } from 'react'
import { categorizeRows, findDuplicateColumns, mergeCsvUploads } from '../api/merge'
import type {
  CategorizeResponse,
  CategorySuggestion,
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

type ToolMode = 'unifier' | 'categorizer'

const OCCURRENCE_PREVIEW_LIMIT = 6

export function MergeScreen({ filenames, onBack }: MergeScreenProps) {
  const [mergeState, setMergeState] = useState<LoadState>('loading')
  const [mergeResult, setMergeResult] = useState<MergeResponse | null>(null)
  const [toolMode, setToolMode] = useState<ToolMode>('unifier')
  const [selectedColumns, setSelectedColumns] = useState<SelectedCsvColumn[]>([])
  const [categorizerColumns, setCategorizerColumns] = useState<SelectedCsvColumn[]>([])
  const [duplicateResult, setDuplicateResult] = useState<DuplicateColumnResponse | null>(null)
  const [categorizeResult, setCategorizeResult] = useState<CategorizeResponse | null>(null)
  const [duplicateState, setDuplicateState] = useState<LoadState>('idle')
  const [categorizeState, setCategorizeState] = useState<LoadState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [hoveredColumn, setHoveredColumn] = useState<HoveredColumn | null>(null)
  const [focusedCellKeys, setFocusedCellKeys] = useState<string[]>([])
  const cellRefs = useRef<Record<string, HTMLTableCellElement | null>>({})

  useEffect(() => {
    async function startMerge() {
      setMergeState('loading')
      setErrorMessage('')
      setSelectedColumns([])
      setCategorizerColumns([])
      setDuplicateResult(null)
      setCategorizeResult(null)
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

  function getSelectedColumn(file: CsvDetail, column: string) {
    return {
      filename: file.filename,
      column,
      values: file.rows.map((row) => row[column] ?? ''),
    }
  }

  function getCategorizerRole(file: CsvDetail, column: string) {
    const index = categorizerColumns.findIndex(
      (selected) => selected.filename === file.filename && selected.column === column,
    )

    if (index === 0) return 'category-source'
    if (index === 1) return 'category-target'
    if (index > 1) return 'category-context'

    return ''
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

  function getColumnClassName(
    isHovered: boolean,
    isSelected: boolean,
    isFocused = false,
    categorizerRole = '',
  ) {
    return [
      isHovered ? 'hovered-column' : '',
      isSelected ? 'selected-column-cell' : '',
      categorizerRole ? `${categorizerRole}-cell` : '',
      isFocused ? 'focused-match-cell' : '',
    ]
      .filter(Boolean)
      .join(' ')
  }

  function resetToolResults() {
    setDuplicateResult(null)
    setCategorizeResult(null)
    setErrorMessage('')
    setFocusedCellKeys([])
  }

  function switchToolMode(nextMode: ToolMode) {
    setToolMode(nextMode)
    resetToolResults()
  }

  function toggleColumn(file: CsvDetail, column: string) {
    resetToolResults()

    if (toolMode === 'categorizer') {
      setCategorizerColumns((current) => {
        const exists = current.some(
          (selected) => selected.filename === file.filename && selected.column === column,
        )

        if (exists) {
          return current.filter(
            (selected) => selected.filename !== file.filename || selected.column !== column,
          )
        }

        return [...current, getSelectedColumn(file, column)]
      })
      return
    }

    setSelectedColumns((current) => {
      const exists = current.some(
        (selected) => selected.filename === file.filename && selected.column === column,
      )

      if (exists) {
        return current.filter(
          (selected) => selected.filename !== file.filename || selected.column !== column,
        )
      }

      return [...current, getSelectedColumn(file, column)]
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

  function focusSuggestion(suggestion: CategorySuggestion) {
    const targetColumn = categorizeResult?.targetColumn.column

    if (!targetColumn) return

    const key = getCellKey(suggestion.filename, targetColumn, suggestion.rowIndex)
    setFocusedCellKeys([key])
    cellRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
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

  async function handleCategorizeRows() {
    if (categorizerColumns.length < 2) return

    setCategorizeState('loading')
    setErrorMessage('')
    setFocusedCellKeys([])

    try {
      const data = await categorizeRows({
        categoryColumn: categorizerColumns[0],
        targetColumn: categorizerColumns[1],
        contextColumns: categorizerColumns.slice(2),
      })
      setCategorizeResult(data)
      setCategorizeState('idle')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not categorize rows.')
      setCategorizeState('error')
    }
  }

  const activeSelectionCount = toolMode === 'categorizer' ? categorizerColumns.length : selectedColumns.length
  const selectedCategoryColumn = categorizerColumns[0]
  const selectedTargetColumn = categorizerColumns[1]

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
      {(mergeState === 'error' || duplicateState === 'error' || categorizeState === 'error') && (
        <p className="status error">{errorMessage}</p>
      )}

      {mergeResult && mergeState !== 'loading' && (
        <>
          <div className="merge-toolbar">
            <div className="tool-switcher" aria-label="Merge tools">
              <button
                className={toolMode === 'unifier' ? 'tool-tab active' : 'tool-tab'}
                type="button"
                onClick={() => switchToolMode('unifier')}
              >
                Unifier
              </button>
              <button
                className={toolMode === 'categorizer' ? 'tool-tab active' : 'tool-tab'}
                type="button"
                onClick={() => switchToolMode('categorizer')}
              >
                Categorizer
              </button>
            </div>

            {toolMode === 'categorizer' ? (
              <button
                className="primary-button"
                type="button"
                disabled={categorizerColumns.length < 2 || categorizeState === 'loading'}
                onClick={handleCategorizeRows}
              >
                {categorizeState === 'loading' ? 'Categorizing...' : 'Suggest categories'}
              </button>
            ) : (
              <button
                className="primary-button"
                type="button"
                disabled={selectedColumns.length === 0 || duplicateState === 'loading'}
                onClick={handleFindDuplicates}
              >
                {duplicateState === 'loading' ? 'Finding...' : 'Find unification candidates'}
              </button>
            )}

            <span className="muted">
              {activeSelectionCount} selected column{activeSelectionCount === 1 ? '' : 's'}
            </span>
          </div>

          {toolMode === 'categorizer' && (
            <div className="categorizer-selection-strip">
              <span className="category-source-chip">
                Categories: {selectedCategoryColumn ? `${selectedCategoryColumn.filename} / ${selectedCategoryColumn.column}` : 'pick first'}
              </span>
              <span className="category-target-chip">
                To fill: {selectedTargetColumn ? `${selectedTargetColumn.filename} / ${selectedTargetColumn.column}` : 'pick second'}
              </span>
              <span>
                Context: {Math.max(categorizerColumns.length - 2, 0)} column{categorizerColumns.length - 2 === 1 ? '' : 's'}
              </span>
            </div>
          )}

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
                            const isSelected = toolMode === 'unifier' && isColumnSelected(file, column)
                            const isHovered = isColumnHovered(file, column)
                            const categorizerRole = toolMode === 'categorizer' ? getCategorizerRole(file, column) : ''

                            return (
                              <th
                                className={getColumnClassName(isHovered, isSelected, false, categorizerRole)}
                                key={column}
                                onMouseEnter={() =>
                                  setHoveredColumn({ filename: file.filename, column })
                                }
                                onMouseLeave={() => setHoveredColumn(null)}
                              >
                                <button
                                  className={
                                    isSelected || categorizerRole
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
                              const isSelected = toolMode === 'unifier' && isColumnSelected(file, column)
                              const isHovered = isColumnHovered(file, column)
                              const isFocused = isCellFocused(file, column, rowIndex)
                              const categorizerRole = toolMode === 'categorizer' ? getCategorizerRole(file, column) : ''
                              const cellKey = getCellKey(file.filename, column, rowIndex)

                              return (
                                <td
                                  className={getColumnClassName(isHovered, isSelected, isFocused, categorizerRole)}
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

          {duplicateResult && toolMode === 'unifier' && (
            <section className="duplicate-results">
              <div className="duplicate-results-heading">
                <div>
                  <h3>Unification candidates</h3>
                  <p className="muted">
                    {duplicateResult.summary.tagCount} entries scanned across{' '}
                    {duplicateResult.summary.uniqueTagCount} unique values.
                  </p>
                </div>
                <span>{duplicateResult.unificationCandidates.length} candidates</span>
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
            </section>
          )}

          {categorizeResult && toolMode === 'categorizer' && (
            <section className="duplicate-results">
              <div className="duplicate-results-heading">
                <div>
                  <h3>Category suggestions</h3>
                  <p className="muted">
                    {categorizeResult.summary.categoryCount} categories checked for{' '}
                    {categorizeResult.summary.rowCount} rows.
                  </p>
                </div>
                <span>{categorizeResult.summary.llmStatus}</span>
              </div>

              {categorizeResult.suggestions.map((suggestion) => (
                <article key={`${suggestion.filename}-${suggestion.rowIndex}`}>
                  <div className="duplicate-result-body">
                    <div className="candidate-heading-row">
                      <div>
                        <strong>{suggestion.suggestedCategory}</strong>
                        <p className="muted">
                          Row {suggestion.rowIndex + 1}: {suggestion.targetValue || 'blank target'}
                        </p>
                      </div>
                      <button
                        className="secondary-button compact-button"
                        type="button"
                        onClick={() => focusSuggestion(suggestion)}
                      >
                        Focus row
                      </button>
                    </div>
                    <p className="muted">{suggestion.reason}</p>
                    {Object.keys(suggestion.context).length > 0 && (
                      <div className="suggestion-context">
                        {Object.entries(suggestion.context).map(([column, value]) => (
                          <span key={column}>
                            {column}: {value || 'blank'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span>{Math.round(suggestion.confidence * 100)}% {suggestion.method}</span>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </section>
  )
}
