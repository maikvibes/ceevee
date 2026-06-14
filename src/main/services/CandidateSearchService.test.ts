import { describe, expect, it } from 'vitest'
import { extractJobDescriptionSignals, scoreCandidateForJobDescription } from './CandidateSearchScoring'

describe('candidate JD search scoring', () => {
  const tags = ['React', 'TypeScript', 'Node.js', 'Product Design']

  it('extracts deterministic signals from configured tags and known job types', () => {
    const signals = extractJobDescriptionSignals(
      'We need a TypeScript engineer with React experience for a Product role.',
      tags,
      ['IT', 'Product', 'Design']
    )

    expect(signals.tags).toEqual(['React', 'TypeScript'])
    expect(signals.jobTypes).toEqual(['Product'])
    expect(signals.keywords).toContain('engineer')
  })

  it('scores exact tag, job type, headline, and raw text evidence separately', () => {
    const score = scoreCandidateForJobDescription(
      {
        id: 1,
        first_name: 'Ava',
        last_name: 'Nguyen',
        headline: 'Senior React Engineer',
        job_type: 'IT',
        status: 'Pending Review',
        tags: JSON.stringify(['React', 'TypeScript']),
        raw_text: 'Built Node.js services and React frontends.',
        created_at: new Date().toISOString()
      },
      {
        tags: ['React', 'TypeScript', 'Node.js'],
        jobTypes: ['IT'],
        keywords: ['engineer', 'services'],
        normalizedText: 'react typescript node.js engineer services'
      }
    )

    expect(score.tagScore).toBeGreaterThan(0.55)
    expect(score.exactReasons).toEqual(
      expect.arrayContaining([
        'Matched tags: React, TypeScript',
        'Job type matched IT',
        'Headline matched: engineer',
        'CV text matched: services'
      ])
    )
  })
})
