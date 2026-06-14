export interface JobDescriptionSignals {
  tags: string[]
  jobTypes: string[]
  keywords: string[]
  normalizedText: string
}

export interface CandidateSearchResult {
  candidate: SearchableCandidate
  tagScore: number
  semanticScore: number | null
  score: number
  exactReasons: string[]
  semanticReasons: string[]
  matchingTags: string[]
}

export interface SearchableCandidate {
  id: number
  first_name?: string | null
  last_name?: string | null
  headline?: string | null
  job_type?: string | null
  status?: string | null
  tags?: string | null
  raw_text?: string | null
  email?: string | null
  phone?: string | null
  file_path?: string | null
  created_at?: string | null
  updated_at?: string | null
  [key: string]: unknown
}

const STOP_WORDS = new Set([
  'with', 'from', 'that', 'this', 'have', 'will', 'your', 'their', 'they', 'them',
  'role', 'need', 'needs', 'candidate', 'experience', 'years', 'work', 'team'
])

export function extractJobDescriptionSignals(jobDescription: string, configuredTags: string[], configuredJobTypes: string[]): JobDescriptionSignals {
  const normalizedText = normalize(jobDescription)
  return {
    tags: configuredTags.filter((tag) => includesTerm(normalizedText, tag)),
    jobTypes: configuredJobTypes.filter((jobType) => includesTerm(normalizedText, jobType)),
    keywords: extractKeywords(normalizedText),
    normalizedText
  }
}

export function scoreCandidateForJobDescription(candidate: SearchableCandidate, signals: JobDescriptionSignals): CandidateSearchResult {
  const candidateTags = parseTags(candidate.tags)
  const matchingTags = candidateTags.filter((tag) => signals.tags.some((signalTag) => normalize(signalTag) === normalize(tag)))
  const exactReasons: string[] = []
  let score = 0

  if (matchingTags.length > 0) {
    score += Math.min(0.6, matchingTags.length * 0.22)
    exactReasons.push(`Matched tags: ${matchingTags.join(', ')}`)
  }

  const candidateJobType = candidate.job_type || ''
  if (candidateJobType && signals.jobTypes.some((jobType) => normalize(jobType) === normalize(candidateJobType))) {
    score += 0.18
    exactReasons.push(`Job type matched ${candidateJobType}`)
  }

  const headlineHits = signals.keywords.filter((keyword) => includesTerm(normalize(candidate.headline || ''), keyword)).slice(0, 3)
  if (headlineHits.length > 0) {
    score += Math.min(0.12, headlineHits.length * 0.04)
    exactReasons.push(`Headline matched: ${headlineHits.join(', ')}`)
  }

  const rawHits = signals.keywords.filter((keyword) => includesTerm(normalize(candidate.raw_text || ''), keyword)).slice(0, 4)
  if (rawHits.length > 0) {
    score += Math.min(0.18, rawHits.length * 0.045)
    exactReasons.push(`CV text matched: ${rawHits.join(', ')}`)
  }

  if (candidate.status === 'Pending Review') score += 0.03

  const tagScore = Math.min(score, 1)
  return {
    candidate,
    tagScore,
    semanticScore: null,
    score: tagScore,
    exactReasons,
    semanticReasons: [],
    matchingTags
  }
}

function extractKeywords(normalizedText: string): string[] {
  const words = normalizedText
    .split(/[^a-z0-9.+#-]+/i)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))

  return Array.from(new Set(words)).slice(0, 40)
}

function includesTerm(normalizedText: string, term: string) {
  const normalizedTerm = normalize(term)
  if (!normalizedTerm) return false
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`, 'i').test(normalizedText)
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function parseTags(tags?: string | null) {
  try {
    return JSON.parse(tags || '[]') as string[]
  } catch {
    return []
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
