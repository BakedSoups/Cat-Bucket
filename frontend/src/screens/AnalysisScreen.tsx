import { useEffect, useMemo, useState } from 'react'
import { getCsvUpload } from '../api/uploads'
import type { CsvDetail, LoadState, UploadSummary } from '../types'

type AnalysisScreenProps = {
  uploads: UploadSummary[]
}

export function AnalysisScreen({ uploads }: AnalysisScreenProps) {
  const [selectedFilename, setSelectedFilename] = useState('')
  const [selectedColumn, setSelectedColumn] = useState('')
  const [csvDetail, setCsvDetail] = useState<CsvDetail | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    async function loadCsv() {
      if (!selectedFilename) {
        setCsvDetail(null)
        setSelectedColumn('')
        return
      }

      setLoadState('loading')
      setErrorMessage('')
      setSelectedColumn('')

      try {
        const data = await getCsvUpload(selectedFilename)
        setCsvDetail(data)
        setLoadState('idle')
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Could not load CSV.')
        setLoadState('error')
      }
    }

    void loadCsv()
  }, [selectedFilename])

  const frequencies = useMemo(() => {
    if (!csvDetail || !selectedColumn) return []

    const counts = new Map<string, number>()

    for (const row of csvDetail.rows) {
      const value = row[selectedColumn] ?? ''
      const tags = value
        .split(/[,;|\n]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)

      for (const tag of tags.length > 0 ? tags : value.trim() ? [value.trim()] : []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }

    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, 30)
  }, [csvDetail, selectedColumn])

  const maxCount = Math.max(...frequencies.map((item) => item.count), 1)

  return (
    <section className="csv-preview">
      <div className="panel-heading">
        <div>
          <h2>Column frequency</h2>
          <p>Select a CSV, then choose a column to chart.</p>
        </div>
      </div>

      <div className="analysis-file-grid">
        {uploads.map((upload) => (
          <button
            className={upload.filename === selectedFilename ? 'analysis-file-card active' : 'analysis-file-card'}
            key={upload.filename}
            type="button"
            onClick={() => setSelectedFilename(upload.filename)}
          >
            <strong>{upload.filename}</strong>
            <span>{upload.rows} rows, {upload.columns.length} columns</span>
          </button>
        ))}
      </div>

      {loadState === 'loading' && <p className="muted">Loading CSV...</p>}
      {loadState === 'error' && <p className="status error">{errorMessage}</p>}

      {csvDetail && loadState !== 'loading' && (
        <div className="analysis-column-picker">
          <strong>Columns</strong>
          <div>
            {csvDetail.columns.map((column) => (
              <button
                className={column === selectedColumn ? 'active' : ''}
                key={column}
                type="button"
                onClick={() => setSelectedColumn(column)}
              >
                {column}
              </button>
            ))}
          </div>
        </div>
      )}

      {!selectedFilename && <p className="empty-state">Choose a CSV to start analysis.</p>}
      {selectedFilename && csvDetail && !selectedColumn && (
        <p className="empty-state">Choose a column to build a frequency chart.</p>
      )}

      {selectedColumn && frequencies.length === 0 && loadState !== 'loading' && (
        <p className="empty-state">No values found for this column.</p>
      )}

      {selectedColumn && frequencies.length > 0 && (
        <div className="bar-chart" aria-label="Column frequency bar chart">
          {frequencies.map((item) => (
            <div className="bar-row" key={item.label}>
              <span>{item.label}</span>
              <div>
                <strong style={{ inlineSize: `${(item.count / maxCount) * 100}%` }} />
              </div>
              <small>{item.count}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
