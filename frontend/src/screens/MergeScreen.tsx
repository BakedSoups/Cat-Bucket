import { useEffect, useState } from 'react'
import { findDuplicateColumns, mergeCsvUploads } from '../api/merge'
import type {
  CsvDetail,
  DuplicateColumnResponse,
  LoadState,
  MergeResponse,
  SelectedCsvColumn,
} from '../types'

type MergeScreenProps = {
  filenames: string[]
  onBack: () => void
}

export function MergeScreen({ filenames, onBack }: MergeScreenProps) {
  const [mergeState, setMergeState] = useState<LoadState>('loading')
  const [mergeResult, setMergeResult] = useState<MergeResponse | null>(null)
  const [selectedColumns, setSelectedColumns] = useState<SelectedCsvColumn[]>([])
  const [duplicateResult, setDuplicateResult] = useState<DuplicateColumnResponse | null>(null)
  const [duplicateState, setDuplicateState] = useState<LoadState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    async function startMerge() {
      setMergeState('loading')
      setErrorMessage('')
      setSelectedColumns([])
      setDuplicateResult(null)

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

  function toggleColumn(file: CsvDetail, column: string) {
    setDuplicateResult(null)
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

  async function handleFindDuplicates() {
    if (selectedColumns.length === 0) return

    setDuplicateState('loading')
    setErrorMessage('')

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
              {duplicateState === 'loading' ? 'Finding...' : 'Find duplicates'}
            </button>
            <span className="muted">
              {selectedColumns.length} selected column{selectedColumns.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="sheet-preview-grid">
            {mergeResult.files.map((file) => {
              const visibleColumns = file.columns.slice(0, 5)

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
                            const isSelected = selectedColumns.some(
                              (selected) =>
                                selected.filename === file.filename && selected.column === column,
                            )

                            return (
                              <th key={column}>
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
                            {visibleColumns.map((column) => (
                              <td key={column}>{row[column]}</td>
                            ))}
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
              <h3>Duplicate matches</h3>
              {duplicateResult.matches.length === 0 && (
                <p className="muted">No duplicate values found.</p>
              )}
              {duplicateResult.matches.map((match) => (
                <article key={`${match.filename}-${match.column}`}>
                  <strong>
                    {match.filename} / {match.column}
                  </strong>
                  <span>{match.duplicateCount} duplicate values</span>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </section>
  )
}
