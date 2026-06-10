import { useState } from 'react';
import { useTaskQueue } from '../../contexts/TaskQueueContext';
import {
  UploadCloud,
  CheckCircle,
  XCircle,
  Loader2,
  ListTodo,
  FileText,
  X,
  AlertTriangle,
  Plus,
  Trash2,
  Minus,
  Maximize2
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

const getProgressPercentage = (status: string) => {
  if (status.startsWith("OCR:")) {
    const pct = parseInt(status.split(":")[1]) || 0;
    return 30 + Math.floor(pct * 0.3);
  }
  switch (status) {
    case "Queued": return 10;
    case "Extracting": return 30;
    case "AI_Analyzing": return 60;
    case "Syncing to Notion": return 80;
    case "Uploading CV to Notion": return 85;
    case "Attaching CV to Notion Page": return 95;
    case "Complete": return 100;
    case "Failed": return 100;
    default: return 0;
  }
};

const getHumanReadableStatus = (status: string) => {
  if (status.startsWith("OCR:")) return `Performing OCR... (${status.split(":")[1]}%)`;
  switch (status) {
    case "Queued": return "Waiting in queue...";
    case "Extracting": return "Extracting text...";
    case "AI_Analyzing": return "Analyzing with AI...";
    case "Syncing to Notion": return "Preparing Notion sync...";
    case "Uploading CV to Notion": return "Uploading CV to Notion...";
    case "Attaching CV to Notion Page": return "Linking to Notion...";
    case "Complete": return "Done";
    case "Failed": return "Error processing";
    case "Warning": return "Done with warnings";
    default: return status;
  }
};

const getStatusIcon = (status: string) => {
  if (status === "Complete") return <CheckCircle className="size-5 text-success" />;
  if (status === "Failed") return <XCircle className="size-5 text-destructive" />;
  if (status === "Warning") return <AlertTriangle className="size-5 text-warning" />;
  if (status === "Queued") return <ListTodo className="size-5 text-muted-foreground" />;
  return <Loader2 className="size-5 text-info animate-spin" />;
};

export function TaskQueueDrawer() {
  const { isDrawerOpen, setIsDrawerOpen, isDraggingOver, tasks, enqueueFiles, removeTask, clearQueue } = useTaskQueue();
  const [isMinimized, setIsMinimized] = useState(false);
  const navigate = useNavigate();

  const handleManualAddFiles = async () => {
    const res = await window.api.selectFiles();
    if (res.success && res.filePaths) {
      await enqueueFiles(res.filePaths);
      setIsDrawerOpen(true);
    }
  };

  const successCount = tasks.filter((t) => t.status === 'Complete').length;
  const errorCount = tasks.filter((t) => t.status === 'Failed').length;
  const warningCount = tasks.filter((t) => t.status === 'Warning').length;
  const inProgressCount = tasks.length - successCount - errorCount - warningCount;

  const isOpen = isDrawerOpen || isDraggingOver;
  const isActuallyMinimized = isMinimized && !isDraggingOver;

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 flex flex-col transition-all duration-300 ease-in-out ${isOpen ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}
      style={{ width: isActuallyMinimized ? '20rem' : 'min(48rem, calc(100vw - 2rem))' }}
    >
      <div className="bg-card/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl w-full flex flex-col overflow-hidden">
        {/* Header */}
        <div 
          className={`flex items-center justify-between px-6 py-3 bg-accent/20 transition-colors ${isActuallyMinimized ? 'cursor-pointer hover:bg-accent/40' : 'border-b border-border/50'}`}
          onClick={() => isActuallyMinimized && setIsMinimized(false)}
        >
          <div className="flex items-center gap-3">
            <UploadCloud className="size-5 text-primary" />
            <h3 className="font-semibold text-sm tracking-tight hidden sm:block">Queue</h3>
            <div className="flex items-center gap-3 ml-1 sm:ml-2 sm:border-l sm:border-border/50 sm:pl-4 text-xs font-medium">
              {inProgressCount > 0 && (
                <span className="flex items-center gap-1 text-info" title="In Progress">
                  <Loader2 className="size-3.5 animate-spin" /> {inProgressCount}
                </span>
              )}
              {successCount > 0 && (
                <span className="flex items-center gap-1 text-success" title="Completed">
                  <CheckCircle className="size-3.5" /> {successCount}
                </span>
              )}
              {warningCount > 0 && (
                <span className="flex items-center gap-1 text-warning" title="Completed with Warnings">
                  <AlertTriangle className="size-3.5" /> {warningCount}
                </span>
              )}
              {errorCount > 0 && (
                <span className="flex items-center gap-1 text-destructive" title="Failed">
                  <XCircle className="size-3.5" /> {errorCount}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isActuallyMinimized && (
              <>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={(e) => { e.stopPropagation(); handleManualAddFiles(); }}>
                  <Plus className="size-4 mr-1" /> Add Files
                </Button>
                {tasks.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); clearQueue(); }}>
                    <Trash2 className="size-4 mr-1" /> Clear
                  </Button>
                )}
              </>
            )}
            <Button 
              variant="ghost" 
              size="icon" 
              className="size-8 ml-2 text-muted-foreground hover:text-foreground" 
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(!isMinimized);
              }}
              title={isMinimized ? "Expand" : "Minimize"}
            >
              {isMinimized ? <Maximize2 className="size-4" /> : <Minus className="size-4" />}
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="size-8 text-muted-foreground hover:text-foreground" 
              onClick={(e) => {
                e.stopPropagation();
                setIsDrawerOpen(false);
              }}
              title="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Content area – always rendered, collapses via max-height */}
        <div
          className="transition-all duration-300 ease-in-out overflow-hidden"
          style={{
            maxHeight: isActuallyMinimized ? '0px' : '50vh',
            opacity: isActuallyMinimized ? 0 : 1,
          }}
        >
          <div className="relative overflow-y-auto" style={{ maxHeight: '50vh' }}>
            {isDraggingOver && (
              <div className="absolute inset-0 z-10 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 border-4 border-dashed border-primary/50 m-2 rounded-xl">
                <UploadCloud className="size-16 text-primary animate-bounce mb-4" />
                <h2 className="text-2xl font-bold text-primary">Drop to Queue</h2>
                <p className="text-muted-foreground mt-2">PDF, DOCX, or LinkedIn URLs</p>
              </div>
            )}

            {/* Task List */}
            <div className="p-4 space-y-3">
              {tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <FileText className="size-10 opacity-30 mb-2" />
                  <p className="text-sm">Queue is empty</p>
                </div>
              ) : (
                tasks.map((task) => {
                  const isError = task.status === "Failed";
                  const isWarning = task.status === "Warning";
                  const progress = getProgressPercentage(task.status);
    
                  return (
                    <Card
                      key={task.id}
                      className={`group relative transition-all shadow-sm ${isError ? "bg-destructive/5 border-destructive/20" : ""} ${isWarning ? "bg-warning/5 border-warning/20" : ""}`}
                    >
                      <CardContent className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div
                            className={`flex items-center gap-3 ${isError || isWarning || task.status !== "Complete" ? "cursor-default" : "cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-lg -mx-2 px-2 py-1 transition-colors"}`}
                            onClick={async () => {
                              if (task.status === "Complete" || isWarning) {
                                const res = await window.api.getCandidateByFilepath(task.file_path);
                                if (res.success && res.id) {
                                  navigate(`/cv-list?candidateId=${res.id}`);
                                }
                              }
                            }}
                          >
                            {getStatusIcon(task.status)}
                            <div className="flex flex-col truncate max-w-[250px]">
                              <p className="text-sm font-medium leading-none mb-1 truncate" title={task.file_path.split(/[/\\]/).pop()}>
                                {task.file_path.split(/[/\\]/).pop()}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {getHumanReadableStatus(task.status)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge
                              variant={isError ? "destructive" : task.status === "Complete" || isWarning ? "default" : "secondary"}
                              className={`uppercase text-[10px] ${isWarning ? "bg-warning text-warning-foreground hover:bg-warning/80" : ""}`}
                            >
                              {task.status}
                            </Badge>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeTask(task.id); }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted text-muted-foreground hover:text-destructive rounded-md"
                              title="Remove Task"
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        </div>
    
                        <div className="w-full relative">
                          <Progress
                            value={progress}
                            className={`h-1.5 ${isError ? "bg-destructive/20 [&>div]:bg-destructive" : ""} ${isWarning ? "bg-warning/20 [&>div]:bg-warning" : ""} ${task.status === "Complete" ? "[&>div]:bg-success" : ""}`}
                          />
                        </div>
    
                        {task.error_message && (
                          <p className={`text-xs p-1.5 rounded border ${isWarning ? "text-warning bg-warning/10 border-warning/20" : "text-destructive bg-destructive/10 border-destructive/20"}`}>
                            {task.error_message}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
