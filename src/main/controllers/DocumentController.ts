import { ipcMain, dialog } from "electron";
import * as fs from "fs";
import { documentQueue } from "../services/DocumentQueueService";
import db from "../db";

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
        db.prepare("DELETE FROM document_tasks WHERE id = ?").run(taskId);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("clear-document-queue", async () => {
      try {
        db.prepare("DELETE FROM document_tasks").run();
        documentQueue.clearQueue();
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

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
        return { success: true, base64: data.buffer };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });
  }
}

export const documentController = new DocumentController();
