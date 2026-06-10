import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { MasterPasswordDialog } from '../components/settings/MasterPasswordDialog';

interface TaskQueueContextType {
  isDrawerOpen: boolean;
  setIsDrawerOpen: (isOpen: boolean) => void;
  isDraggingOver: boolean;
  tasks: any[];
  enqueueFiles: (filePaths: string[]) => Promise<void>;
  removeTask: (taskId: number) => Promise<void>;
  clearQueue: () => Promise<void>;
  loadTasks: () => Promise<void>;
}

const TaskQueueContext = createContext<TaskQueueContextType | undefined>(undefined);

export function TaskQueueProvider({ children }: { children: React.ReactNode }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [pendingFilePaths, setPendingFilePaths] = useState<string[]>([]);

  useEffect(() => {
    loadTasks();
    const removeListener = window.api.onDocumentProgress(() => {
      loadTasks();
    });
    return () => {
      if (removeListener) removeListener();
    };
  }, []);

  const loadTasks = async () => {
    const data = await window.api.getDocumentTasks();
    setTasks(data || []);
  };

  const enqueueFiles = async (filePaths: string[]) => {
    if (filePaths.length === 0) return;

    const isLocked = await window.api.isKeystoreLocked();
    if (isLocked) {
      setPendingFilePaths(filePaths);
      setShowPasswordDialog(true);
      return;
    }

    const provider = localStorage.getItem('active_ai_provider') || 'openrouter';
    let hasError = false;
    for (const path of filePaths) {
      const res = await window.api.enqueueDocument(path, provider);
      if (!res.success) {
        toast.error(res.error || `Failed to queue document: ${path}`);
        hasError = true;
      }
    }
    if (!hasError && filePaths.length > 0) {
      toast.success(`Queued ${filePaths.length} document(s)`);
    }
    loadTasks();
  };

  const removeTask = async (taskId: number) => {
    const res = await window.api.removeDocumentTask(taskId);
    if (res.success) {
      toast.success('Task removed from queue.');
      loadTasks();
    } else {
      toast.error(res.error || 'Failed to remove task.');
    }
  };

  const clearQueue = async () => {
    const res = await window.api.clearDocumentQueue();
    if (res.success) {
      toast.success('Queue cleared.');
      loadTasks();
    } else {
      toast.error(res.error || 'Failed to clear queue.');
    }
  };

  const dragCounter = useRef(0);

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current++;
      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        setIsDraggingOver(true);
        setIsDrawerOpen(true);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current--;
      if (dragCounter.current === 0) {
        setIsDraggingOver(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDraggingOver(false);

      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        // Note: the original validation logic was using FileValidatorContext, but we can just use paths here and let the backend reject.
        // For accurate path fetching on Electron drop:
        const validPaths = files.map((file: any) => window.api?.getPathForFile ? window.api.getPathForFile(file) : file.path).filter(Boolean);
        
        if (validPaths.length > 0) {
          await enqueueFiles(validPaths);
        }
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  return (
    <TaskQueueContext.Provider
      value={{
        isDrawerOpen,
        setIsDrawerOpen,
        isDraggingOver,
        tasks,
        enqueueFiles,
        removeTask,
        clearQueue,
        loadTasks
      }}
    >
      {children}
      <MasterPasswordDialog
        open={showPasswordDialog}
        onOpenChange={(open) => {
          setShowPasswordDialog(open);
          if (!open && pendingFilePaths.length > 0) {
            setPendingFilePaths([]);
          }
        }}
        onSuccess={async () => {
          if (pendingFilePaths.length > 0) {
            await enqueueFiles(pendingFilePaths);
            setPendingFilePaths([]);
          }
        }}
      />
    </TaskQueueContext.Provider>
  );
}

export function useTaskQueue() {
  const context = useContext(TaskQueueContext);
  if (context === undefined) {
    throw new Error('useTaskQueue must be used within a TaskQueueProvider');
  }
  return context;
}
