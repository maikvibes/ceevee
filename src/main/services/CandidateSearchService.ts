import db from '../db'
import { VectorSearchService } from './VectorSearchService'
import {
  CandidateSearchResult,
  JobDescriptionSignals,
  SearchableCandidate,
  extractJobDescriptionSignals,
  scoreCandidateForJobDescription
} from './CandidateSearchScoring'

export { extractJobDescriptionSignals, scoreCandidateForJobDescription }

export interface CandidateSearchParams {
  jobDescription: string
  filters?: CandidateSearchFilter[]
  limit?: number
}

export interface CandidateSearchFilter {
  id: string
  value: string | number | boolean | null
}

export class CandidateSearchService {
  static async search(params: CandidateSearchParams) {
    const jobDescription = params.jobDescription.trim()
    if (!jobDescription) {
      return { success: true, data: { results: [], semantic: { available: false, reason: 'Enter a job description to search.' } } }
    }

    const tags = db.prepare('SELECT name FROM custom_tags WHERE category = ?').all('Skill') as { name: string }[]
    const jobTypes = db.prepare('SELECT name FROM custom_tags WHERE category = ?').all('JobType') as { name: string }[]
    const signals = extractJobDescriptionSignals(
      jobDescription,
      tags.map((tag) => tag.name),
      jobTypes.map((tag) => tag.name)
    )

    const candidates = this.getSqlCandidates(signals, params.filters || [], Math.max(params.limit || 25, 50))
    const scored = new Map<number, CandidateSearchResult>()

    for (const candidate of candidates) {
      const score = scoreCandidateForJobDescription(candidate, signals)
      if (score.score > 0) scored.set(candidate.id, score)
    }

    let semantic = { available: false, reason: 'Semantic search is disabled or not indexed.' as string | null }
    try {
      const semanticResults = await VectorSearchService.query(jobDescription, params.limit || 25)
      semantic = { available: semanticResults.available, reason: semanticResults.reason }
      if (semanticResults.available) {
        for (const match of semanticResults.results) {
          if (!match.candidateId) continue
          const candidate = scored.get(match.candidateId)?.candidate || this.getCandidate(match.candidateId)
          if (!candidate) continue

          const existing = scored.get(match.candidateId) || scoreCandidateForJobDescription(candidate, signals)
          const semanticScore = Math.max(0, 1 - Math.min(match.distance, 1))
          existing.semanticScore = Math.max(existing.semanticScore || 0, semanticScore)
          existing.semanticReasons = [`Semantic CV chunk matched (${Math.round(semanticScore * 100)}%)`]
          existing.score = existing.tagScore * 0.65 + existing.semanticScore * 0.35
          scored.set(match.candidateId, existing)
        }
      }
    } catch (error: unknown) {
      semantic = { available: false, reason: getErrorMessage(error) }
    }

    const results = Array.from(scored.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, params.limit || 25)

    return { success: true, data: { results, semantic, signals } }
  }

  private static getCandidate(id: number): SearchableCandidate | undefined {
    return db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as SearchableCandidate | undefined
  }

  private static getSqlCandidates(signals: JobDescriptionSignals, filters: CandidateSearchFilter[], limit: number) {
    const clauses = ['1=1']
    const values: (string | number | boolean | null)[] = []

    const terms = [...signals.tags, ...signals.jobTypes, ...signals.keywords.slice(0, 8)]
    if (terms.length > 0) {
      clauses.push(`(${terms.map(() => '(tags LIKE ? OR job_type LIKE ? OR headline LIKE ? OR raw_text LIKE ?)').join(' OR ')})`)
      for (const term of terms) {
        const value = `%${term}%`
        values.push(value, value, value, value)
      }
    }

    for (const filter of filters) {
      if (!filter.value || filter.value === 'all') continue
      if (filter.id === 'status' || filter.id === 'job_type') {
        clauses.push(`${filter.id} = ?`)
        values.push(filter.value)
      }
    }

    values.push(limit)
    return db.prepare(`
      SELECT * FROM candidates
      WHERE ${clauses.join(' AND ')}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `).all(...values) as SearchableCandidate[]
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
