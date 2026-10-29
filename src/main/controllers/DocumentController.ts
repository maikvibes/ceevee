import { ipcMain, dialog } from "electron";
import * as fs from "fs";
import { documentQueue } from "../services/DocumentQueueService";
import db from "../db";
import { CVVersionService } from "../services/CVVersionService";
import { NotionSyncService } from "../services/NotionSyncService";

class DocumentController {
  registerHandlers() {
    ipcMain.handle(
      "enqueue-document",
      async (_, params: { filePath: string; provider: string }) => {
        try {
          await documentQueue.enqueueNew(params.filePath, params.provider);
          return { success: true };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    );

    ipcMain.handle("get-document-tasks", async () => {
      return db
        .prepare("SELECT * FROM document_tasks ORDER BY created_at DESC")
        .all();
    });

    ipcMain.handle("remove-document-task", async (_, taskId: number) => {
      try {
        const task = db.prepare("SELECT status, staged_path FROM document_tasks WHERE id = ?").get(taskId) as { status: string; staged_path: string | null } | undefined;
        if (!task) throw new Error("Task not found.");
        if (!["Complete", "Failed", "Warning"].includes(task.status)) throw new Error("Wait for processing or resolve the match before removing this task.");
        db.prepare("DELETE FROM document_tasks WHERE id = ?").run(taskId);
        const removed = !task.staged_path || CVVersionService.discardFile(task.staged_path);
        return { success: true, warning: removed ? undefined : 'The queued file could not be removed; cleanup will be retried.' };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("clear-document-queue", async () => {
      try {
        documentQueue.clearQueue();
        const queued = db.prepare("SELECT staged_path FROM document_tasks WHERE status IN ('Queued', 'Failed', 'Warning', 'Complete') AND staged_path IS NOT NULL").all() as { staged_path: string }[];
        db.prepare("DELETE FROM document_tasks WHERE status IN ('Complete', 'Failed', 'Warning', 'Queued') AND id NOT IN (SELECT task_id FROM cv_match_reviews)").run();
        const removed = queued.map((file) => CVVersionService.discardFile(file.staged_path)).every(Boolean);
        const remainingReviews = (db.prepare('SELECT COUNT(*) AS count FROM cv_match_reviews').get() as { count: number }).count;
        return { success: true, remainingReviews, warning: removed ? undefined : 'Some queued files could not be removed; cleanup will be retried.' };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('retry-document-task', async (_, taskId: number) => {
      try { await documentQueue.retryTask(taskId); return { success: true } }
      catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle('get-cv-match-review', async (_, taskId: number) => {
      try { return { success: true, data: CVVersionService.getReview(taskId) } }
      catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle('resolve-cv-match-review', async (event, taskId: number, candidateId: number | null) => {
      try {
        const result = CVVersionService.resolveReview(taskId, candidateId)
        let warning: string | undefined
        if (!result.duplicate) {
          if (!await CVVersionService.refreshIndex(result.candidateId)) warning = 'Search indexing failed and will be retried.'
          if (NotionSyncService.isAutoSyncEnabled()) {
            try { await NotionSyncService.syncCandidate(result.candidateId) }
            catch (error: any) { warning = [warning, `Notion sync failed: ${error.message}`].filter(Boolean).join(' ') }
          }
        }
        event.sender.send('document-progress', { taskId, status: 'Complete' })
        return { success: true, candidateId: result.candidateId, warning }
      } catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle("select-files", async () => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ["openFile", "multiSelections"],
          filters: [
            { name: "Documents", extensions: ["pdf", "docx"] },
            { name: "All Files", extensions: ["*"] }
          ]
        });
        
        if (result.canceled) {
          return { success: true, filePaths: [] };
        }
        
        return { success: true, filePaths: result.filePaths };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("read-local-pdf", async (_, filePath: string) => {
      try {
        if (!fs.existsSync(filePath)) {
          throw new Error("File not found");
        }
        const data = fs.readFileSync(filePath);
        return { success: true, base64: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });
  }
}

export const documentController = new DocumentController();
