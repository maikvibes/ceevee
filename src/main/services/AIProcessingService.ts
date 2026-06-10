import db from '../db'
import { IAIProvider } from './ai/IAIProvider'
import { OpenRouterProvider } from './ai/OpenRouterProvider'
import { AnthropicProvider } from './ai/AnthropicProvider'

export class AIProcessingService {
  /**
   * Prompts the AI to extract candidate data into structured markdown.
   */
  static async extractCandidateData(rawText: string, _provider: string, _apiKey: string, _model: string): Promise<any> {
    const customTagsRecords = db.prepare('SELECT name FROM custom_tags WHERE category = ?').all('Skill') as { name: string }[]
    const allowedTagsStr = customTagsRecords.map(t => t.name).join(', ')
    
    const jobTypesRecords = db.prepare('SELECT name FROM custom_tags WHERE category = ?').all('JobType') as { name: string }[]
    const allowedJobTypesStr = jobTypesRecords.map(t => t.name).join(', ')

    const _prompt = `
You are an expert technical recruiter and HR data extractor. 
I am going to provide you with the raw text extracted from a candidate's CV or resume. 
Your job is to extract the following information and output it EXACTLY in the structured markdown format below.

Output Format:
**First Name:** [Extract or deduce first name]
**Last Name:** [Extract or deduce last name]
**Email:** [Extract email address, or N/A]
**Phone:** [Extract phone number, or N/A]
**Location:** [Extract candidate's city, state, or country, or N/A]
**Job Type:** [Extract ONE of the following options that best fits: ${allowedJobTypesStr || 'Other'}]
**Headline:** [The candidate's current or most prominent job title]
**Summary:** [summarize this candidate's CV in a very short paragraph, preferably 2-4 sentences long. Focus on their experience and line of work]
**Tags:** [Extract 5-10 technical skills from the Allowed Tags below. If they possess skills not in the list, you may add them, but prioritize these: ${allowedTagsStr || 'None specified'}]

Rules:
1. Do not include any text outside of this markdown structure.
2. If a field is missing, output "N/A".
3. CRITICAL: If the provided text does not appear to be a Resume or Curriculum Vitae (CV) in any way, you must output EXACTLY the string "REJECT: NOT_A_CV" and nothing else. Do not attempt to parse it.

Candidate CV Text:
---
${rawText}
---
`
    console.log(`[AIProcessingService] Using provider: ${_provider}...`)

    let strategy: IAIProvider
    
    switch (_provider.toLowerCase()) {
      case 'anthropic':
        strategy = new AnthropicProvider()
        break
      case 'openrouter':
      default:
        strategy = new OpenRouterProvider()
        break
    }

    try {
      const aiResponseText = await strategy.generateCompletion(_prompt, _apiKey, _model)
      
      if (aiResponseText.includes('REJECT: NOT_A_CV')) {
        throw new Error('Document rejected: Not a valid CV or Resume.')
      }

      return this.parseMarkdownOutput(aiResponseText)
    } catch (error) {
      console.error(`[AIProcessingService] Strategy execution failed for ${_provider}:`, error)
      throw error
    }
  }

  /**
   * Parses the structured markdown using regex.
   */
  private static parseMarkdownOutput(markdown: string) {
    const extractField = (fieldName: string) => {
      // Matches "**Field Name:** value"
      const regex = new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+)`, 'i')
      const match = markdown.match(regex)
      const value = match ? match[1].trim() : ''
      return value === 'N/A' ? '' : value
    }

    return {
      first_name: extractField('First Name'),
      last_name: extractField('Last Name'),
      email: extractField('Email'),
      phone: extractField('Phone'),
      location: extractField('Location'),
      job_type: extractField('Job Type'),
      headline: extractField('Headline'),
      summary: extractField('Summary'),
      tags: extractField('Tags').split(',').map(t => t.trim()).filter(Boolean)
    }
  }
}
