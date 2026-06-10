import { Client } from '@notionhq/client'
import db from '../db'
import { KeyStoreService } from './KeyStoreService'
import * as fs from 'node:fs/promises';

export class NotionSyncService {
  static getClientAndDatabaseId() {
    const row = db.prepare('SELECT * FROM api_key_store WHERE provider = ?').get('notion') as any
    if (!row) throw new Error('Notion API key not configured')

    const apiKey = KeyStoreService.decrypt(row.encrypted_key, row.iv, row.auth_tag)
    const databaseId = row.model
    if (!databaseId) throw new Error('Notion Database ID not configured')

    const notion = new Client({ auth: apiKey })
    return { notion, databaseId }
  }

  static isAutoSyncEnabled() {
    const row = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get('notion_auto_sync') as any
    return row?.setting_value === 'true'
  }

  static async syncCandidate(candidateId: number, onProgress?: (status: string) => void) {
    try {
      if (onProgress) onProgress('Syncing to Notion')

      let notion: Client, databaseId: string
      try {
        ({ notion, databaseId } = this.getClientAndDatabaseId())
      } catch (err: any) {
        throw new Error(`Notion configuration error: ${err.message}`)
      }

      const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as any
      if (!candidate) throw new Error('Candidate not found')

      const tagsArray = JSON.parse(candidate.tags || '[]')
      const multiSelectTags = tagsArray.map((t: string) => ({ name: t }))

      const properties: any = {
        'Name': {
          title: [
            {
              text: {
                content: `${candidate.first_name} ${candidate.last_name}`
              }
            }
          ]
        }
      }

      if (candidate.email) properties['Email'] = { email: candidate.email }
      if (candidate.phone) properties['Phone'] = { phone_number: candidate.phone }
      if (candidate.location) properties['Location'] = { rich_text: [{ text: { content: candidate.location } }] }
      if (candidate.job_type) properties['Job Type'] = { select: { name: candidate.job_type } }
      if (multiSelectTags.length > 0) properties['Tags'] = { multi_select: multiSelectTags }
      if (candidate.status) properties['Status'] = { select: { name: candidate.status } }

      let children: any[] = []
      if (candidate.file_path) {
        try {

          const path = require('path')
          const ext = path.extname(candidate.file_path).toLowerCase()
          let mimeType = 'application/pdf'
          if (ext === '.docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          else if (ext === '.doc') mimeType = 'application/msword'
          else if (ext === '.txt') mimeType = 'text/plain'

          if (onProgress) onProgress('Uploading CV to Notion')
          const fileUploadId = await notion.fileUploads.create({
            mode: 'single_part'
          });
          
          const { buffer, byteOffset, length } = await fs.readFile(candidate.file_path)
          await notion.fileUploads.send({
            file_upload_id: fileUploadId.id,
            file: {
              filename: path.basename(candidate.file_path),
              data: new Blob([new Uint8Array(buffer, byteOffset, length)], { type: mimeType })
            },
          })

          if (onProgress) onProgress('Attaching CV to Notion Page')

          if (fileUploadId) {
            children.push({
              object: 'block',
              type: 'file',
              file: {
                type: 'file_upload',
                file_upload: { id: fileUploadId.id }
              }
            })
          }
        } catch (uploadErr: any) {
          console.error('[NotionSyncService] Failed to upload CV file:', uploadErr)
          // Continue creating page even if file upload fails – but we'll note it
        }
      }

      let response: any
      try {
        response = await notion.pages.create({
          parent: { database_id: databaseId },
          properties,
          ...(children.length > 0 && { children })
        }) as any;
      } catch (pageErr: any) {
        throw new Error(`Failed to create Notion page: ${pageErr.message}`)
      }

      db.prepare(`
        INSERT INTO notion_sync_history (candidate_id, status, notion_page_url)
        VALUES (?, 'Success', ?)
      `).run(candidate.id, response.url)

      return { success: true, url: response.url }
    } catch (error: any) {
      console.error('[NotionSyncService] Sync error:', error)
      db.prepare(`
        INSERT INTO notion_sync_history (candidate_id, status, error_message)
        VALUES (?, 'Failed', ?)
      `).run(candidateId, error.message)
      throw error
    }
  }
}
