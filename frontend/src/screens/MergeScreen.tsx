import { useEffect, useState } from 'react'
import { mergeCsvUploads } from '../api/merge'
import type { LoadState, MergeResponse } from '../types'

type MergeScreenProps = {
  filenames: string[]
  onBack: () => void
}

export function MergeScreen({ filenames, onBack }: MergeScreenProps) {
  const [mergeState, setMergeState] = useState<LoadState>('loading')
  const [mergeResult, setMergeResult] = useState<MergeResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    async function startMerge() {
      setMergeState('loading')
      setErrorMessage('')

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

      {mergeState === 'loading' && <p className="muted">Sending selected CSVs to backend...</p>}
      {mergeState === 'error' && <p className="status error">{errorMessage}</p>}

      {mergeResult && mergeState !== 'loading' && (
        <div className="merge-summary">
          {mergeResult.files.map((file) => (
            <article key={file.filename}>
              <h3>{file.filename}</h3>
              <p>
                {file.row_count} rows, {file.columns.length} columns
              </p>
              <ul>
                {file.columns.map((column) => (
                  <li key={column}>{column}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
