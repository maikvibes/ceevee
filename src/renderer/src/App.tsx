import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from './components/layout/MainLayout'
import { HomeView } from './views/HomeView'
import { CVListView } from './views/CVListView'
import { SettingsView } from './views/SettingsView'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'

import { Titlebar } from './components/ui/titlebar'

function App() {

  useEffect(() => {
    const removeListener = window.api.onDocumentProgress((data: any) => {
      if (data.status === 'Failed') {
        toast.error(`Processing Error: ${data.context || 'Unknown error occurred'}`)
      }
    })
    return () => {
      if (removeListener) removeListener()
    }
  }, [])

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Titlebar />
      <HashRouter>
        <MainLayout>
          <Routes>
            <Route path="/" element={<HomeView />} />
            <Route path="/cv-list" element={<CVListView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </MainLayout>
      </HashRouter>
      <Toaster />
    </div>
  )
}

export default App
