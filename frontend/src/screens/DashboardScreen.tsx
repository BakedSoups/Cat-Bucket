import { useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { UploadPanel } from '../components/UploadPanel'
import { uploadCsv } from '../api/uploads'
import type { UploadResponse, UploadState, UploadSummary } from '../types'

type DashboardScreenProps = {
  onUploadComplete: (filename: string) => Promise<void>
  uploads: UploadSummary[]
}

export function DashboardScreen({ onUploadComplete, uploads }: DashboardScreenProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const selectedFileLabel = useMemo(() => {
    if (!selectedFile) {
      return 'No CSV selected'
    }

    const sizeInKb = Math.max(1, Math.round(selectedFile.size / 1024))
    return `${selectedFile.name} - ${sizeInKb} KB`
  }, [selectedFile])

  const totalRows = uploads.reduce((total, upload) => total + upload.rows, 0)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
    setUploadResult(null)
    setErrorMessage('')
    setUploadState('idle')
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedFile) {
      setErrorMessage('Choose a CSV file first.')
      setUploadState('error')
      return
    }

    setUploadState('uploading')
    setErrorMessage('')

    try {
      const data = await uploadCsv(selectedFile)
      setUploadResult(data)
      setUploadState('success')
      await onUploadComplete(data.filename)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Upload failed.')
      setUploadState('error')
    }
  }

  return (
    <>
      <section className="metrics" aria-label="Upload metrics">
        <article>
          <span>Uploaded files</span>
          <strong>{uploads.length}</strong>
        </article>
        <article>
          <span>Parsed rows</span>
          <strong>{totalRows}</strong>
        </article>
        <article>
          <span>Latest columns</span>
          <strong>{uploadResult?.columns.length ?? uploads[0]?.columns.length ?? 0}</strong>
        </article>
      </section>

      <UploadPanel
        errorMessage={errorMessage}
        onFileChange={handleFileChange}
        onUpload={handleUpload}
        selectedFileLabel={selectedFileLabel}
        uploadResult={uploadResult}
        uploadState={uploadState}
      />
    </>
  )
}
