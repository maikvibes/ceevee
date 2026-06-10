import { useState, useEffect } from 'react'
import { CVSearchAndFilterBar } from '../components/cv/CVSearchAndFilterBar'
import { CVDataTable } from '../components/cv/CVDataTable'
import { toast } from 'sonner'
import { DateRange } from 'react-day-picker'
import { useSearchParams } from 'react-router-dom'
import { CandidateDetailView } from './CandidateDetailView'

export function CVListView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const candidateIdParam = searchParams.get('candidateId')
  const highlightedCandidateId = candidateIdParam ? parseInt(candidateIdParam, 10) : null

  const clearHighlight = () => {
    if (candidateIdParam) {
      searchParams.delete('candidateId')
      setSearchParams(searchParams, { replace: true })
    }
  }

  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [tag, setTag] = useState('all')
  const [status, setStatus] = useState('all')
  const [jobType, setJobType] = useState('all')
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 500)
    return () => clearTimeout(timer)
  }, [search])

  const handleExportCsv = async () => {
    const res = await window.api.exportCandidatesCsv({ search: debouncedSearch, tag, status })
    if (res.success && !res.canceled) {
      // Optional: show a success toast or alert
      console.log('Exported to', res.filePath)
    } else if (!res.success) {
      console.error('Export failed:', res.error)
      toast.error(`Export failed: ${res.error}`)
    }
  }

  return (
    <div className="px-8 h-full max-w-6xl mx-auto flex flex-col">
        <CVSearchAndFilterBar
          search={search}
          setSearch={setSearch}
          tag={tag}
          setTag={setTag}
          status={status}
          setStatus={setStatus}
          jobType={jobType}
          setJobType={setJobType}
          dateRange={dateRange}
          setDateRange={setDateRange}
          onExportCsv={handleExportCsv}
        />

      <div className="flex-1 overflow-hidden relative">
        {selectedCandidateId !== null ? (
          <div className="absolute inset-0 z-50 bg-background">
            <CandidateDetailView
              candidateId={selectedCandidateId}
              onBack={() => setSelectedCandidateId(null)}
            />
          </div>
        ) : (
          <CVDataTable 
            search={debouncedSearch} 
            tag={tag} 
            status={status}
            jobType={jobType}
            dateRange={dateRange}
            onView={(id) => setSelectedCandidateId(id)} 
            highlightedCandidateId={highlightedCandidateId}
            clearHighlight={clearHighlight}
          />
        )}
      </div>
    </div>
  )
}
