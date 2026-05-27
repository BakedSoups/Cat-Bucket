import { useEffect, useState } from 'react'
import { getCsvUpload } from '../api/uploads'
import type { CsvDetail, LoadState } from '../types'

type CsvDetailScreenProps = {
  filename: string
  onBack: () => void
}

export function CsvDetailScreen({ filename, onBack }: CsvDetailScreenProps) {
  const [csv, setCsv] = useState<CsvDetail | null>(null)
  const [detailState, setDetailState] = useState<LoadState>('loading')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    async function loadCsv() {
      setDetailState('loading')
      setErrorMessage('')

      try {
        const data = await getCsvUpload(filename)
        setCsv(data)
        setDetailState('idle')
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Could not load that CSV.')
        setDetailState('error')
      }
    }

    void loadCsv()
  }, [filename])

  return (
    <section className="csv-preview">
      <div className="panel-heading">
        <div>
          <button className="text-button" type="button" onClick={onBack}>
            Back to uploads
          </button>
          <h2>{csv?.filename ?? filename}</h2>
          {csv && (
            <p>
              {csv.row_count} rows, {csv.columns.length} columns
            </p>
          )}
        </div>
      </div>

      {detailState === 'loading' && <p className="muted">Loading CSV...</p>}
      {detailState === 'error' && <p className="status error">{errorMessage}</p>}
      {csv && detailState !== 'loading' && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {csv.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csv.rows.slice(0, 100).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {csv.columns.map((column) => (
                      <td key={column}>{row[column]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {csv.rows.length > 100 && <p className="muted">Showing the first 100 rows.</p>}
        </>
      )}
    </section>
  )
}
