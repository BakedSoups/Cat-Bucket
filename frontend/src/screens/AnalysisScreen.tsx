import { useEffect, useMemo, useState } from 'react'
import { getCsvUpload } from '../api/uploads'
import type { CsvDetail, LoadState, UploadSummary } from '../types'

type AnalysisScreenProps = {
  uploads: UploadSummary[]
}

export function AnalysisScreen({ uploads }: AnalysisScreenProps) {
  const [selectedFilename, setSelectedFilename] = useState(uploads[0]?.filename ?? '')
  const [selectedColumn, setSelectedColumn] = useState('')
  const [csvDetail, setCsvDetail] = useState<CsvDetail | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!selectedFilename && uploads[0]) {
      setSelectedFilename(uploads[0].filename)
    }
  }, [selectedFilename, uploads])

  useEffect(() => {
    async function loadCsv() {
      if (!selectedFilename) return

      setLoadState('loading')
      setErrorMessage('')

      try {
        const data = await getCsvUpload(selectedFilename)
        setCsvDetail(data)
        setSelectedColumn((current) => current || data.columns[0] || '')
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
          <p>Build a bar chart from any CSV column.</p>
        </div>
      </div>

      <div className="analysis-controls">
        <label>
          <span>CSV</span>
          <select value={selectedFilename} onChange={(event) => setSelectedFilename(event.target.value)}>
            {uploads.map((upload) => (
              <option key={upload.filename} value={upload.filename}>
                {upload.filename}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Column</span>
          <select value={selectedColumn} onChange={(event) => setSelectedColumn(event.target.value)}>
            {csvDetail?.columns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loadState === 'loading' && <p className="muted">Loading CSV...</p>}
      {loadState === 'error' && <p className="status error">{errorMessage}</p>}

      {frequencies.length === 0 && loadState !== 'loading' && (
        <p className="empty-state">No values found for this column.</p>
      )}

      {frequencies.length > 0 && (
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
