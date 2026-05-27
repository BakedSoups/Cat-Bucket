import type { ChangeEvent, FormEvent } from 'react'
import type { UploadResponse, UploadState } from '../types'

type UploadPanelProps = {
  errorMessage: string
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onUpload: (event: FormEvent<HTMLFormElement>) => void
  selectedFileLabel: string
  uploadResult: UploadResponse | null
  uploadState: UploadState
}

export function UploadPanel({
  errorMessage,
  onFileChange,
  onUpload,
  selectedFileLabel,
  uploadResult,
  uploadState,
}: UploadPanelProps) {
  return (
    <section className="upload-panel">
      <div className="panel-heading">
        <div>
          <h2>Upload CSV</h2>
          <p>Files are sent to FastAPI for validation and parsing.</p>
        </div>
      </div>

      <form onSubmit={onUpload} className="upload-form">
        <label className="drop-zone">
          <input type="file" accept=".csv,text/csv" onChange={onFileChange} />
          <span>Choose CSV</span>
          <strong>{selectedFileLabel}</strong>
        </label>

        <button type="submit" disabled={uploadState === 'uploading'}>
          {uploadState === 'uploading' ? 'Uploading...' : 'Upload to backend'}
        </button>
      </form>

      {uploadState === 'error' && <p className="status error">{errorMessage}</p>}
      {uploadState === 'success' && uploadResult && (
        <div className="status success">
          <strong>{uploadResult.filename}</strong> accepted with {uploadResult.rows} rows.
        </div>
      )}
    </section>
  )
}
