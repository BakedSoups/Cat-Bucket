import { useState } from 'react'
import type { LoadState, UploadSummary } from '../types'
import { formatDate, formatFileSize } from '../utils'

type UploadsScreenProps = {
  errorMessage: string
  listState: LoadState
  onMerge: (filenames: string[]) => void
  onOpenCsv: (filename: string) => void
  onRefresh: () => void
  uploads: UploadSummary[]
}

export function UploadsScreen({
  errorMessage,
  listState,
  onMerge,
  onOpenCsv,
  onRefresh,
  uploads,
}: UploadsScreenProps) {
  const [selectedFilenames, setSelectedFilenames] = useState<string[]>([])

  function toggleSelected(filename: string) {
    setSelectedFilenames((current) =>
      current.includes(filename)
        ? current.filter((selectedFilename) => selectedFilename !== filename)
        : [...current, filename],
    )
  }

  return (
    <section className="uploads-list">
      <div className="panel-heading">
        <div>
          <h2>Uploaded CSVs</h2>
          <p>Select files to merge, or open one to inspect its rows.</p>
        </div>
        <div className="panel-actions">
          <button
            className="primary-button"
            type="button"
            disabled={selectedFilenames.length < 2}
            onClick={() => onMerge(selectedFilenames)}
          >
            Merge {selectedFilenames.length > 0 ? `(${selectedFilenames.length})` : ''}
          </button>
          <button className="secondary-button" type="button" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>

      {listState === 'error' && <p className="status error">{errorMessage}</p>}
      {listState === 'loading' && <p className="muted">Loading uploads...</p>}

      <div className="file-list">
        {uploads.map((upload) => (
          <div className="file-row" key={upload.filename}>
            <label className="file-select">
              <input
                checked={selectedFilenames.includes(upload.filename)}
                type="checkbox"
                onChange={() => toggleSelected(upload.filename)}
              />
              <span>
                <strong>{upload.filename}</strong>
                <small>
                  {formatFileSize(upload.size)} - {formatDate(upload.modified_at)}
                </small>
              </span>
            </label>
            <div className="file-row-meta">
              <span>{upload.rows} rows</span>
              <button className="text-button" type="button" onClick={() => onOpenCsv(upload.filename)}>
                Open
              </button>
            </div>
          </div>
        ))}
      </div>

      {uploads.length === 0 && listState !== 'loading' && (
        <p className="empty-state">No CSV uploads yet.</p>
      )}
    </section>
  )
}
