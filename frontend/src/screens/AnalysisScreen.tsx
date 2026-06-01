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
    if (!csvDetail || !selectedColumn) {
      return []
    }

    const counts = new Map<string, number>()

    for (const row of csvDetail.rows) {
      const value = row[selectedColumn] ?? ''
      const tags: string[] = []

      for (const tag of value.split(/[,;|\n]+/)) {
        const trimmedTag = tag.trim()

        if (trimmedTag) {
          tags.push(trimmedTag)
        }
      }

      const fallbackValue = value.trim()
      const tagValues = tags.length > 0 ? tags : []

      if (tagValues.length === 0 && fallbackValue) {
        tagValues.push(fallbackValue)
      }

      for (const tag of tagValues) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }

    const frequencyItems: Array<{ label: string; count: number }> = []

    for (const [label, count] of counts.entries()) {
      frequencyItems.push({ label, count })
    }

    return frequencyItems
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, 30)
  }, [csvDetail, selectedColumn])

  let maxCount = 1

  for (const item of frequencies) {
    if (item.count > maxCount) {
      maxCount = item.count
    }
  }

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
