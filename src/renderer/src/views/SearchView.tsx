import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CandidateDetailView } from './CandidateDetailView'
import { Clock, Loader2, Search, Sparkles, UserRound } from 'lucide-react'
import { toast } from 'sonner'

interface CandidateSearchResult {
  candidate: Record<string, unknown>
  tagScore: number
  semanticScore: number | null
  score: number
  exactReasons: string[]
  semanticReasons: string[]
  matchingTags: string[]
}

interface SearchHistoryItem {
  id: number
  job_description: string
  result_count: number
  semantic_available: boolean
  created_at: string
}

export function SearchView() {
  const [jobDescription, setJobDescription] = useState('')
  const [results, setResults] = useState<CandidateSearchResult[]>([])
  const [history, setHistory] = useState<SearchHistoryItem[]>([])
  const [semantic, setSemantic] = useState<{ available: boolean; reason: string | null }>({ available: false, reason: null })
  const [isSearching, setIsSearching] = useState(false)
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null)

  useEffect(() => {
    void loadHistory()
  }, [])

  const loadHistory = async () => {
    const response = await window.api.getJobSearchHistory(12)
    if (response.success && response.data) {
      setHistory(response.data.map((item) => ({
        id: item.id,
        job_description: item.job_description,
        result_count: item.result_count,
        semantic_available: item.semantic_available,
        created_at: item.created_at
      })))
    }
  }

  const runSearch = async (description = jobDescription) => {
    const trimmed = description.trim()
    if (!trimmed) {
      toast.error('Paste a job description before searching.')
      return
    }

    setIsSearching(true)
    const response = await window.api.searchCandidatesForJobDescription({
      jobDescription: trimmed,
      limit: 25
    })
    setIsSearching(false)

    if (!response.success || !response.data) {
      toast.error(`Search failed: ${response.error || 'Unknown error'}`)
      return
    }

    setJobDescription(trimmed)
    setResults(response.data.results)
    setSemantic(response.data.semantic)
    await loadHistory()
  }

  if (selectedCandidateId !== null) {
    return (
      <div className="h-full min-h-[720px]">
        <CandidateDetailView candidateId={selectedCandidateId} onBack={() => setSelectedCandidateId(null)} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full max-w-7xl gap-6">
      <aside className="hidden w-72 shrink-0 border-r border-border/70 pr-6 lg:block">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Clock className="size-4" />
          Search History
        </div>
        <div className="space-y-2">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved searches yet.</p>
          ) : history.map((item) => (
            <button
              key={item.id}
              onClick={() => runSearch(item.job_description)}
              className="w-full rounded-md border border-border bg-card p-3 text-left text-sm transition-colors hover:bg-accent"
            >
              <span className="line-clamp-3 text-foreground">{item.job_description}</span>
              <span className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{item.result_count} matches</span>
                <span>{formatDate(item.created_at)}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="rounded-md border border-border bg-card p-4">
          <Textarea
            value={jobDescription}
            onChange={(event) => setJobDescription(event.target.value)}
            placeholder="Paste a job description, hiring brief, or role requirements..."
            className="min-h-40 resize-y border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
          />
          <div className="mt-4 flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="size-4" />
              <span>{semantic.available ? 'Semantic search is included.' : semantic.reason || 'Exact matching runs first.'}</span>
            </div>
            <Button onClick={() => runSearch()} disabled={isSearching} className="gap-2">
              {isSearching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Search
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {results.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-md border border-dashed border-border text-center">
              <UserRound className="mb-3 size-9 text-muted-foreground" />
              <p className="font-medium">No search results yet</p>
              <p className="max-w-md text-sm text-muted-foreground">
                The exact tag engine works locally. Semantic evidence appears when vector search is enabled and indexed.
              </p>
            </div>
          ) : results.map((result) => (
            <article key={numberField(result.candidate, 'id')} className="rounded-md border border-border bg-card p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-2">
                  <div>
                    <h3 className="text-lg font-semibold">
                      {stringField(result.candidate, 'first_name')} {stringField(result.candidate, 'last_name')}
                    </h3>
                    <p className="text-sm text-muted-foreground">{stringField(result.candidate, 'headline') || 'No headline'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{stringField(result.candidate, 'status') || 'No status'}</span>
                    <span>{stringField(result.candidate, 'location') || 'No location'}</span>
                    <span>{stringField(result.candidate, 'job_type') || 'No job type'}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {result.matchingTags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline">{Math.round(result.score * 100)}%</Badge>
                  <Button variant="outline" size="sm" onClick={() => setSelectedCandidateId(numberField(result.candidate, 'id'))}>
                    View
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <p className="mb-2 font-medium">Needle-Haystack Evidence</p>
                  <ul className="space-y-1 text-muted-foreground">
                    {result.exactReasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 font-medium">Semantic Evidence</p>
                  {result.semanticReasons.length > 0 ? (
                    <ul className="space-y-1 text-muted-foreground">
                      {result.semanticReasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">{semantic.reason || 'No semantic match contributed to this result.'}</p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                <span>{stringField(result.candidate, 'email') || 'No email'}</span>
                <span>{stringField(result.candidate, 'phone') || 'No phone'}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' ? value : Number(value || 0)
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString()
}
