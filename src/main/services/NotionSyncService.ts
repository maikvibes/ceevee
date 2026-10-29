import { Client } from '@notionhq/client'
import db from '../db'
import { KeyStoreService } from './KeyStoreService'
import * as fs from 'node:fs/promises';

export class NotionSyncService {
  private static pending = new Map<number, Promise<any>>()
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
    const previous = this.pending.get(candidateId)
    const request = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => this.performSync(candidateId, onProgress))
    this.pending.set(candidateId, request)
    try { return await request } finally { if (this.pending.get(candidateId) === request) this.pending.delete(candidateId) }
  }

  private static async performSync(candidateId: number, onProgress?: (status: string) => void) {
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

      let mapping = db.prepare('SELECT page_id, page_url, synced_version_id FROM notion_candidate_pages WHERE candidate_id = ?').get(candidateId) as { page_id: string; page_url: string; synced_version_id: number | null } | undefined
      if (!mapping) {
        const previous = db.prepare("SELECT notion_page_url FROM notion_sync_history WHERE candidate_id = ? AND status = 'Success' AND notion_page_url IS NOT NULL ORDER BY id DESC LIMIT 1").get(candidateId) as { notion_page_url: string } | undefined
        if (previous) {
          const compact = previous.notion_page_url.replace(/-/g, '')
          const id = compact.match(/([0-9a-f]{32})(?:[?#/]|$)/i)?.[1]
          if (!id) throw new Error('Could not identify the previously synced Notion page. Resolve the existing sync before creating another page.')
          mapping = { page_id: id, page_url: previous.notion_page_url, synced_version_id: null }
        }
      }
      const needsAttachment = !mapping || (!!candidate.current_cv_version_id && candidate.current_cv_version_id !== mapping.synced_version_id)
      let uploadedCurrentFile = !candidate.file_path

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

      // Add candidate summary to page body
      if (candidate.summary) {
        children.push({
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{ text: { content: 'Candidate Summary' } }]
          }
        })
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ text: { content: candidate.summary } }]
          }
        })
        children.push({
          object: 'block',
          type: 'divider',
          divider: {}
        })
      }

        if (candidate.file_path && needsAttachment) {
          try {
            const path = require('path')
            const ext = path.extname(candidate.file_path).toLowerCase()
            let mimeType = 'application/pdf'
            if (ext === '.docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            else if (ext === '.doc') mimeType = 'application/msword'
            else if (ext === '.txt') mimeType = 'text/plain'

            if (onProgress) onProgress('Uploading CV to Notion')
            const fileUploadResponse = await notion.fileUploads.create({
              mode: 'single_part'
            });

            const { buffer, byteOffset, length } = await fs.readFile(candidate.file_path)
            const currentVersion = candidate.current_cv_version_id ? db.prepare('SELECT original_filename FROM candidate_cv_versions WHERE id = ?').get(candidate.current_cv_version_id) as { original_filename: string } | undefined : undefined
            await notion.fileUploads.send({
              file_upload_id: fileUploadResponse.id,
              file: {
                filename: currentVersion?.original_filename || path.basename(candidate.file_path),
                data: new Blob([new Uint8Array(buffer, byteOffset, length)], { type: mimeType })
              },
            })

            uploadedCurrentFile = true
            // Only attach the block if BOTH create + send succeeded
            if (onProgress) onProgress('Attaching CV to Notion Page')
            children.push({
              object: 'block',
              type: 'file',
              file: {
                type: 'file_upload',
                file_upload: { id: fileUploadResponse.id }
              }
            })
          } catch (uploadErr: any) {
            throw new Error(`Failed to upload CV file to Notion: ${uploadErr.message}`)
          }
        }

      let response: any
      try {
        if (mapping) {
          response = await notion.pages.update({ page_id: mapping.page_id, properties }) as any
          // Keep previous attachments as history and append the new current version only once.
          if (candidate.current_cv_version_id && candidate.current_cv_version_id !== mapping.synced_version_id && children.length) {
            await notion.blocks.children.append({ block_id: mapping.page_id, children: children as any })
          }
          response.url ||= mapping.page_url
        } else {
          response = await notion.pages.create({
            parent: { database_id: databaseId }, properties,
            ...(children.length > 0 ? { children } : {})
          }) as any
        }
        db.prepare(`INSERT INTO notion_candidate_pages (candidate_id, page_id, page_url, synced_version_id) VALUES (?, ?, ?, ?)
          ON CONFLICT(candidate_id) DO UPDATE SET page_id = excluded.page_id, page_url = excluded.page_url, synced_version_id = excluded.synced_version_id`)
          .run(candidateId, response.id || mapping?.page_id, response.url, uploadedCurrentFile ? (candidate.current_cv_version_id || null) : (mapping?.synced_version_id || null))
      } catch (pageErr: any) {
        throw new Error(`Failed to sync Notion page: ${pageErr.message}`)
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
