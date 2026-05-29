import { useEffect, useRef, useState } from 'react'
import { autoCategorizeRows, categorizeRows, findDuplicateColumns, mergeCsvUploads, saveMergeChanges } from '../api/merge'
import type {
  CategorizeResponse,
  CategorySuggestion,
  CsvDetail,
  DuplicateColumnResponse,
  LoadState,
  MergeResponse,
  CsvCellUpdate,
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


export function MergeScreen({ filenames, onBack }: MergeScreenProps) {
  const [mergeState, setMergeState] = useState<LoadState>('loading')
  const [mergeResult, setMergeResult] = useState<MergeResponse | null>(null)
  const [toolMode, setToolMode] = useState<ToolMode>('unifier')
  const [activeFilename, setActiveFilename] = useState('')
  const [selectedColumns, setSelectedColumns] = useState<SelectedCsvColumn[]>([])
  const [categorizerColumns, setCategorizerColumns] = useState<SelectedCsvColumn[]>([])
  const [duplicateResult, setDuplicateResult] = useState<DuplicateColumnResponse | null>(null)
  const [categorizeResult, setCategorizeResult] = useState<CategorizeResponse | null>(null)
  const [duplicateState, setDuplicateState] = useState<LoadState>('idle')
  const [categorizeState, setCategorizeState] = useState<LoadState>('idle')
  const [autoCategorizeState, setAutoCategorizeState] = useState<LoadState>('idle')
  const [saveState, setSaveState] = useState<LoadState>('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [hoveredColumn, setHoveredColumn] = useState<HoveredColumn | null>(null)
  const [focusedCellKeys, setFocusedCellKeys] = useState<string[]>([])
  const [approvedSuggestionKeys, setApprovedSuggestionKeys] = useState<string[]>([])
  const [dismissedSuggestionKeys, setDismissedSuggestionKeys] = useState<string[]>([])
  const [approvedCandidateKeys, setApprovedCandidateKeys] = useState<string[]>([])
  const [dismissedCandidateKeys, setDismissedCandidateKeys] = useState<string[]>([])
  const [expandedMethodKeys, setExpandedMethodKeys] = useState<string[]>([])
  const cellRefs = useRef<Record<string, HTMLTableCellElement | null>>({})

  useEffect(() => {
    async function startMerge() {
      setMergeState('loading')
      setErrorMessage('')
      setSelectedColumns([])
      setCategorizerColumns([])
      setDuplicateResult(null)
      setCategorizeResult(null)
      setAutoCategorizeState('idle')
      setHoveredColumn(null)
      setFocusedCellKeys([])
      setSaveMessage('')
      setApprovedSuggestionKeys([])
      setDismissedSuggestionKeys([])
      setApprovedCandidateKeys([])
      setDismissedCandidateKeys([])
      setExpandedMethodKeys([])
      cellRefs.current = {}

      try {
        const data = await mergeCsvUploads(filenames)
        setMergeResult(data)
        setActiveFilename(data.files[0]?.filename ?? '')
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
    setApprovedSuggestionKeys([])
    setDismissedSuggestionKeys([])
    setApprovedCandidateKeys([])
    setDismissedCandidateKeys([])
    setExpandedMethodKeys([])
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

    if (occurrences[0]) {
      setActiveFilename(occurrences[0].filename)
    }

    window.requestAnimationFrame(() => {
      const firstCell = cellRefs.current[keys[0]]
      firstCell?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    })
  }

  function getCandidateKey(candidate: UnificationCandidate) {
    return `${candidate.canonicalTag}::${candidate.values.join('|')}`
  }

  function getSuggestionKey(suggestion: CategorySuggestion) {
    return `${suggestion.filename}::${suggestion.rowIndex}`
  }

  function focusSuggestion(suggestion: CategorySuggestion) {
    const targetColumn = categorizeResult?.targetColumn.column

    if (!targetColumn) return

    const key = getCellKey(suggestion.filename, targetColumn, suggestion.rowIndex)
    setFocusedCellKeys([key])
    setActiveFilename(suggestion.filename)
    window.requestAnimationFrame(() => {
      cellRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    })
  }

  function toggleCandidateApproval(candidate: UnificationCandidate) {
    const key = getCandidateKey(candidate)
    setDismissedCandidateKeys((current) => current.filter((dismissedKey) => dismissedKey !== key))
    setApprovedCandidateKeys((current) =>
      current.includes(key)
        ? current.filter((approvedKey) => approvedKey !== key)
        : [...current, key],
    )
  }

  function toggleCandidateDismissal(candidate: UnificationCandidate) {
    const key = getCandidateKey(candidate)
    setApprovedCandidateKeys((current) => current.filter((approvedKey) => approvedKey !== key))
    setDismissedCandidateKeys((current) =>
      current.includes(key)
        ? current.filter((dismissedKey) => dismissedKey !== key)
        : [...current, key],
    )
  }

  function toggleMethodExpansion(candidate: UnificationCandidate, method: string) {
    const key = `${getCandidateKey(candidate)}::${method}`
    setExpandedMethodKeys((current) =>
      current.includes(key)
        ? current.filter((expandedKey) => expandedKey !== key)
        : [...current, key],
    )
  }

  function isMethodExpanded(candidate: UnificationCandidate, method: string) {
    return expandedMethodKeys.includes(`${getCandidateKey(candidate)}::${method}`)
  }

  function toggleSuggestionApproval(suggestion: CategorySuggestion) {
    const key = getSuggestionKey(suggestion)
    setDismissedSuggestionKeys((current) => current.filter((dismissedKey) => dismissedKey !== key))
    setApprovedSuggestionKeys((current) =>
      current.includes(key)
        ? current.filter((approvedKey) => approvedKey !== key)
        : [...current, key],
    )
  }

  function toggleSuggestionDismissal(suggestion: CategorySuggestion) {
    const key = getSuggestionKey(suggestion)
    setApprovedSuggestionKeys((current) => current.filter((approvedKey) => approvedKey !== key))
    setDismissedSuggestionKeys((current) =>
      current.includes(key)
        ? current.filter((dismissedKey) => dismissedKey !== key)
        : [...current, key],
    )
  }

  function getCandidateOccurrences(candidate: UnificationCandidate) {
    return [
      ...candidate.exactOccurrences,
      ...candidate.fuzzyOccurrences,
      ...candidate.llmOccurrences,
    ]
  }

  function renderMethodOccurrences(
    candidate: UnificationCandidate,
    method: string,
    label: string,
    occurrences: TagOccurrence[],
  ) {
    const expanded = isMethodExpanded(candidate, method)
    const visibleOccurrences = expanded ? occurrences : occurrences.slice(0, 3)

    return (
      <details className="method-section" open={occurrences.length > 0}>
        <summary>
          <span>{label}</span>
          <small>{occurrences.length} match{occurrences.length === 1 ? '' : 'es'}</small>
        </summary>
        {occurrences.length === 0 ? (
          <p className="muted">No {label.toLowerCase()} matches.</p>
        ) : (
          <>
            <ul className="occurrence-list">
              {visibleOccurrences.map((occurrence) => (
                <li key={`${getOccurrenceKey(occurrence)}-${occurrence.value}-${method}`}>
                  <button type="button" onClick={() => focusOccurrences([occurrence])}>
                    <span>{occurrence.value}</span>
                    <small>{formatOccurrenceLocation(occurrence)}</small>
                  </button>
                </li>
              ))}
            </ul>
            {occurrences.length > 3 && (
              <button
                className="text-button inline-text-button"
                type="button"
                onClick={() => toggleMethodExpansion(candidate, method)}
              >
                {expanded ? 'Show first 3' : `Show all ${occurrences.length}`}
              </button>
            )}
          </>
        )}
      </details>
    )
  }



  function buildApprovedCategoryUpdates() {
    if (!categorizeResult) return []

    return categorizeResult.suggestions
      .filter((suggestion) => approvedSuggestionKeys.includes(getSuggestionKey(suggestion)))
      .map((suggestion) => ({
        filename: suggestion.filename,
        column: categorizeResult.targetColumn.column,
        rowIndex: suggestion.rowIndex,
        value: suggestion.suggestedCategory,
        originalValue: suggestion.targetValue,
      })) satisfies CsvCellUpdate[]
  }

  function buildApprovedCandidateUpdates() {
    if (!duplicateResult) return []

    return duplicateResult.unificationCandidates
      .filter((candidate) => approvedCandidateKeys.includes(getCandidateKey(candidate)))
      .flatMap((candidate) =>
        getCandidateOccurrences(candidate).map((occurrence) => ({
          filename: occurrence.filename,
          column: occurrence.column,
          rowIndex: occurrence.rowIndex,
          value: candidate.canonicalTag,
          originalValue: occurrence.value,
        })),
      ) satisfies CsvCellUpdate[]
  }

  async function handleSaveChanges() {
    const updates = toolMode === 'categorizer' ? buildApprovedCategoryUpdates() : buildApprovedCandidateUpdates()

    if (updates.length === 0) return

    setSaveState('loading')
    setSaveMessage('')

    try {
      const result = await saveMergeChanges({ updates })
      setSaveMessage(`Saved ${result.savedUpdateCount} update${result.savedUpdateCount === 1 ? '' : 's'} to CSV.`)
      setSaveState('idle')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save changes.')
      setSaveState('error')
    }
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

  function selectedColumnFromResponse(column: SelectedCsvColumn | null | undefined) {
    return column ? { filename: column.filename, column: column.column, values: column.values } : null
  }

  async function handleAutoCategorizeRows() {
    if (!mergeResult) return

    setAutoCategorizeState('loading')
    setErrorMessage('')
    setFocusedCellKeys([])

    try {
      const data = await autoCategorizeRows({ filenames: mergeResult.selected_filenames })
      const nextColumns = [
        selectedColumnFromResponse(data.categoryColumn),
        selectedColumnFromResponse(data.targetColumn),
        ...data.contextColumns.map(selectedColumnFromResponse),
      ].filter((column): column is SelectedCsvColumn => Boolean(column))

      setCategorizerColumns(nextColumns)
      setCategorizeResult(data)

      if (data.targetColumn?.filename) {
        setActiveFilename(data.targetColumn.filename)
      }

      setAutoCategorizeState('idle')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not auto categorize rows.')
      setAutoCategorizeState('error')
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
  const activeFile = mergeResult?.files.find((file) => file.filename === activeFilename) ?? mergeResult?.files[0]
  const approvedChangeCount = toolMode === 'categorizer' ? buildApprovedCategoryUpdates().length : buildApprovedCandidateUpdates().length

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
      {(mergeState === 'error' || duplicateState === 'error' || categorizeState === 'error' || autoCategorizeState === 'error' || saveState === 'error') && (
        <p className="status error">{errorMessage}</p>
      )}

      {saveMessage && <p className="status success">{saveMessage}</p>}

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
              <div className="toolbar-button-group">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={autoCategorizeState === 'loading' || categorizeState === 'loading'}
                  onClick={handleAutoCategorizeRows}
                >
                  {autoCategorizeState === 'loading' ? 'Auto picking...' : 'Auto categorize'}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={categorizerColumns.length < 2 || categorizeState === 'loading'}
                  onClick={handleCategorizeRows}
                >
                  {categorizeState === 'loading' ? 'Categorizing...' : 'Suggest categories'}
                </button>
              </div>
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

          <div className="merge-workbench">
            <div className="sheet-tabs-panel">
              <div className="sheet-tabs" aria-label="CSV sheets">
                {mergeResult.files.map((file) => (
                  <button
                    className={file.filename === activeFile?.filename ? 'sheet-tab active' : 'sheet-tab'}
                    key={file.filename}
                    type="button"
                    onClick={() => setActiveFilename(file.filename)}
                  >
                    <span>{file.filename}</span>
                    <small>{file.row_count} rows</small>
                  </button>
                ))}
              </div>

              {activeFile && (
                <section className="sheet-preview" key={activeFile.filename}>
                  <div className="sheet-preview-heading">
                    <h3>{activeFile.filename}</h3>
                    <span className="muted">
                      {activeFile.row_count} rows, {activeFile.columns.length} columns
                    </span>
                  </div>

                  <div className="sheet-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          {activeFile.columns.map((column) => {
                            const isSelected = toolMode === 'unifier' && isColumnSelected(activeFile, column)
                            const isHovered = isColumnHovered(activeFile, column)
                            const categorizerRole = toolMode === 'categorizer' ? getCategorizerRole(activeFile, column) : ''

                            return (
                              <th
                                className={getColumnClassName(isHovered, isSelected, false, categorizerRole)}
                                key={column}
                                onMouseEnter={() =>
                                  setHoveredColumn({ filename: activeFile.filename, column })
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
                                  onClick={() => toggleColumn(activeFile, column)}
                                >
                                  {column}
                                </button>
                              </th>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {activeFile.rows.map((row, rowIndex) => (
                          <tr key={`${activeFile.filename}-${rowIndex}`}>
                            {activeFile.columns.map((column) => {
                              const isSelected = toolMode === 'unifier' && isColumnSelected(activeFile, column)
                              const isHovered = isColumnHovered(activeFile, column)
                              const isFocused = isCellFocused(activeFile, column, rowIndex)
                              const categorizerRole = toolMode === 'categorizer' ? getCategorizerRole(activeFile, column) : ''
                              const cellKey = getCellKey(activeFile.filename, column, rowIndex)

                              return (
                                <td
                                  className={getColumnClassName(isHovered, isSelected, isFocused, categorizerRole)}
                                  key={column}
                                  ref={(element) => {
                                    cellRefs.current[cellKey] = element
                                  }}
                                  onMouseEnter={() =>
                                    setHoveredColumn({ filename: activeFile.filename, column })
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
              )}
            </div>

            <aside className="suggestions-sidebar">
              <div className="suggestions-sidebar-heading">
                <h3>{toolMode === 'categorizer' ? 'Category suggestions' : 'Unification suggestions'}</h3>
                <p className="muted">Review results while keeping the full CSV in view.</p>
                <button
                  className="primary-button save-changes-button"
                  type="button"
                  disabled={approvedChangeCount === 0 || saveState === 'loading'}
                  onClick={handleSaveChanges}
                >
                  {saveState === 'loading' ? 'Saving...' : `Save ${approvedChangeCount} change${approvedChangeCount === 1 ? '' : 's'}`}
                </button>
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
                const candidateKey = getCandidateKey(candidate)
                const isApproved = approvedCandidateKeys.includes(candidateKey)
                const isDismissed = dismissedCandidateKeys.includes(candidateKey)

                return (
                  <article
                    className={[isApproved ? 'approved-suggestion' : '', isDismissed ? 'dismissed-suggestion' : '']
                      .filter(Boolean)
                      .join(' ')}
                    key={candidateKey}
                  >
                    <div className="duplicate-result-body">
                      <div className="candidate-heading-row">
                        <div>
                          <strong>{candidate.canonicalTag}</strong>
                          <p className="muted">{candidate.values.join(', ')}</p>
                        </div>
                        <div className="suggestion-actions">
                          <button
                            className="secondary-button compact-button"
                            type="button"
                            onClick={() => focusOccurrences(occurrences)}
                          >
                            Focus
                          </button>
                          <button
                            className="approve-button"
                            type="button"
                            onClick={() => toggleCandidateApproval(candidate)}
                          >
                            {isApproved ? 'Approved' : 'Approve'}
                          </button>
                          <button
                            className="dismiss-button"
                            type="button"
                            onClick={() => toggleCandidateDismissal(candidate)}
                          >
                            {isDismissed ? 'Dismissed' : 'Dismiss'}
                          </button>
                        </div>
                      </div>

                      <div className="candidate-counts" aria-label="Match counts">
                        <span>{candidate.exactMatchCount} exact</span>
                        <span>{candidate.fuzzyMatchCount} fuzzy</span>
                        <span>{candidate.llmMatchCount} LLM</span>
                      </div>

                      {candidate.llmStatus !== 'ready' && (
                        <p className="muted">Offline LLM review is not configured yet.</p>
                      )}

                      <div className="method-sections">
                        {renderMethodOccurrences(candidate, 'exact', 'Exact', candidate.exactOccurrences)}
                        {renderMethodOccurrences(candidate, 'fuzzy', 'Fuzzy', candidate.fuzzyOccurrences)}
                        {renderMethodOccurrences(candidate, 'llm', 'LLM', candidate.llmOccurrences)}
                      </div>
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

              {categorizeResult.questions.length > 0 && (
                <div className="question-panel">
                  <strong>Questions for categorization</strong>
                  <ul>
                    {categorizeResult.questions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                </div>
              )}

              {categorizeResult.suggestions.length === 0 && (
                <p className="muted">No LLM suggestions returned yet.</p>
              )}

              {categorizeResult.suggestions.map((suggestion) => {
                const suggestionKey = getSuggestionKey(suggestion)
                const isApproved = approvedSuggestionKeys.includes(suggestionKey)
                const isDismissed = dismissedSuggestionKeys.includes(suggestionKey)

                return (
                <article
                  className={[isApproved ? 'approved-suggestion' : '', isDismissed ? 'dismissed-suggestion' : '']
                    .filter(Boolean)
                    .join(' ')}
                  key={`${suggestion.filename}-${suggestion.rowIndex}`}
                >
                  <div className="duplicate-result-body">
                    <div className="candidate-heading-row">
                      <div>
                        <strong>{suggestion.suggestedCategory}</strong>
                        <p className="muted">
                          Row {suggestion.rowIndex + 1}: {suggestion.targetValue || 'blank target'}
                        </p>
                      </div>
                      <div className="suggestion-actions">
                        <button
                          className="secondary-button compact-button"
                          type="button"
                          onClick={() => focusSuggestion(suggestion)}
                        >
                          Focus
                        </button>
                        <button
                          className="approve-button"
                          type="button"
                          onClick={() => toggleSuggestionApproval(suggestion)}
                        >
                          {isApproved ? 'Approved' : 'Approve'}
                        </button>
                        <button
                          className="dismiss-button"
                          type="button"
                          onClick={() => toggleSuggestionDismissal(suggestion)}
                        >
                          {isDismissed ? 'Dismissed' : 'Dismiss'}
                        </button>
                      </div>
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
                )
              })}
            </section>
          )}

              {!duplicateResult && !categorizeResult && (
                <div className="empty-suggestions-panel">
                  <strong>No suggestions yet</strong>
                  <p className="muted">Run the active tool to review matches here.</p>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  )
}
