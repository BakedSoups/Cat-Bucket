import { useEffect, useState } from 'react'
import { listCsvUploads } from './api/uploads'
import { CsvDetailScreen } from './screens/CsvDetailScreen'
import { DashboardScreen } from './screens/DashboardScreen'
import { MergeScreen } from './screens/MergeScreen'
import { UploadsScreen } from './screens/UploadsScreen'
import type { LoadState, UploadSummary, View } from './types'
import './App.css'

import cat_icon from './assets/cat-bucket.png' 


function App() {
  const [view, setView] = useState<View>({ name: 'dashboard' })
  const [uploads, setUploads] = useState<UploadSummary[]>([])
  const [listState, setListState] = useState<LoadState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    void loadUploads()
  }, [])

  async function loadUploads() {
    setListState('loading')

    try {
      const data = await listCsvUploads()
      setUploads(data.uploads)
      setListState('idle')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not load CSV uploads.')
      setListState('error')
    }
  }

  async function handleUploadComplete(filename: string) {
    await loadUploads()
    setView({ name: 'csv-detail', filename })
  }

  function handleOpenCsv(filename: string) {
    setView({ name: 'csv-detail', filename })
  }

  function handleMerge(filenames: string[]) {
    setView({ name: 'merge', filenames })
  }

  const title = getTitle(view.name)

  function getTitle(viewName: View['name']) {
    if (viewName === 'dashboard') return 'Dashboard'
    if (viewName === 'uploads') return 'Documents'
    if (viewName === 'merge') return 'Merge'
    if (viewName === 'analysis') return 'Analysis'
    return 'CSV Preview'
  }
  
  return (
    <main className="dashboard">
      <aside className="sidebar" aria-label="Main navigation">
        <div className='brand-row'> 
          <div className="brand">Cat Bucket</div>
          <img className="cat_icon" src={cat_icon} alt="Sitting character" />
        </div>
        <nav>
          <button
            className={`nav-item ${view.name === 'dashboard' ? 'active' : ''}`}
            type="button"
            onClick={() => setView({ name: 'dashboard' })}
          >
            Dashboard
          </button>
          <button
            className={`nav-item ${view.name === 'uploads' || view.name === 'csv-detail' || view.name === 'merge' ? 'active' : ''}`}
            type="button"
            onClick={() => setView({ name: 'uploads' })}
          >
            Documents
          </button>

          <button
            className={`nav-item ${view.name === 'analysis' ? 'active' : ''}`}
            type="button"
            onClick={() => setView({ name: 'analysis' })}
          >
            Analysis
          </button>

        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Easy Data Cleaner</p>
            <h1>{title}</h1>
          </div>
        </header>

        {view.name === 'dashboard' && (
          <DashboardScreen onUploadComplete={handleUploadComplete} uploads={uploads} />
        )}

        {view.name === 'uploads' && (
          <UploadsScreen
            errorMessage={errorMessage}
            listState={listState}
            onMerge={handleMerge}
            onOpenCsv={handleOpenCsv}
            onRefresh={() => void loadUploads()}
            uploads={uploads}
          />
        )}

        {view.name === 'csv-detail' && (
          <CsvDetailScreen filename={view.filename} onBack={() => setView({ name: 'uploads' })} />
        )}

        {view.name === 'merge' && (
          <MergeScreen filenames={view.filenames} onBack={() => setView({ name: 'uploads' })} />
        )}
      </section>
    </main>
  )
}

export default App
