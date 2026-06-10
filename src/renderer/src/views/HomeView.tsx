import { useState, useEffect } from "react";
import { FileValidatorContext } from "../lib/strategies/FileValidatorContext";
import {
  UploadCloud,
  CheckCircle,
  XCircle,
  Loader2,
  ListTodo,
  FileText,
  X,
  AlertTriangle,
} from "lucide-react";
import { MasterPasswordDialog } from "../components/settings/MasterPasswordDialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";

const chartConfig = {
  count: {
    label: "Count",
    color: "var(--primary)",
  },
  status: {
    label: "Status",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

export function HomeView() {
  const navigate = useNavigate();
  const [dragOver, setDragOver] = useState(false);
  const [, setDragCounter] = useState(0);
  const [tasks, setTasks] = useState<any[]>([]);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [pendingFilePaths, setPendingFilePaths] = useState<string[]>([]);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    loadTasks();
    loadStats();

    window.api.onDocumentProgress(() => {
      loadTasks();
      loadStats();
    });
  }, []);

  const loadStats = async () => {
    const res = await window.api.getDashboardStats();
    if (res.success) {
      setStats(res.data);
    }
  };

  const loadTasks = async () => {
    const data = await window.api.getDocumentTasks();
    setTasks(data || []);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter((prev) => prev + 1);
    setDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter((prev) => {
      const newCounter = prev - 1;
      if (newCounter === 0) {
        setDragOver(false);
      }
      return newCounter;
    });
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(0);
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const validPaths: string[] = [];
    const context = new FileValidatorContext();

    for (const file of files) {
      const result = await context.executeValidation(file);
      if (result.valid) {
        const filePath = window.api?.getPathForFile
          ? window.api.getPathForFile(file as any)
          : (file as any).path;
        if (filePath) {
          validPaths.push(filePath);
        }
      } else {
        console.warn(`Invalid file dropped: ${result.error}`);
      }
    }

    if (validPaths.length === 0) return;

    const isLocked = await window.api.isKeystoreLocked();
    if (isLocked) {
      setPendingFilePaths(validPaths);
      setShowPasswordDialog(true);
      return;
    }

    for (const path of validPaths) {
      await executeEnqueue(path);
    }
  };

  const executeEnqueue = async (path: string) => {
    const provider = localStorage.getItem("active_ai_provider") || "openrouter";
    const res = await window.api.enqueueDocument(path, provider);
    if (res.success) {
      setDragOver(false);
      loadTasks();
    } else {
      toast.error(res.error || "Failed to queue document.");
    }
    loadTasks();
  };

  const handleRemoveTask = async (taskId: number) => {
    const res = await window.api.removeDocumentTask(taskId);
    if (res.success) {
      toast.success("Task removed from queue.");
      loadTasks();
    } else {
      toast.error(res.error || "Failed to remove task.");
    }
  };

  const getProgressPercentage = (status: string) => {
    if (status.startsWith("OCR:")) {
      const pct = parseInt(status.split(":")[1]) || 0;
      return 30 + Math.floor(pct * 0.3);
    }
    switch (status) {
      case "Queued":
        return 10;
      case "Extracting":
        return 30;
      case "AI_Analyzing":
        return 60;
      case "Syncing to Notion":
        return 80;
      case "Uploading CV to Notion":
        return 85;
      case "Attaching CV to Notion Page":
        return 95;
      case "Complete":
        return 100;
      case "Failed":
        return 100;
      default:
        return 0;
    }
  };

  const getHumanReadableStatus = (status: string) => {
    if (status.startsWith("OCR:"))
      return `Performing OCR... (${status.split(":")[1]}%)`;
    switch (status) {
      case "Queued":
        return "Waiting in queue...";
      case "Extracting":
        return "Extracting text from document...";
      case "AI_Analyzing":
        return "Analyzing with AI...";
      case "Syncing to Notion":
        return "Preparing Notion sync...";
      case "Uploading CV to Notion":
        return "Uploading CV to Notion...";
      case "Attaching CV to Notion Page":
        return "Linking file to Notion record...";
      case "Complete":
        return "Done";
      case "Failed":
        return "Error processing document";
      case "Warning":
        return "Completed with warnings";
      default:
        return status;
    }
  };

  const getStatusIcon = (status: string) => {
    if (status === "Complete")
      return <CheckCircle className="size-5 text-success" />;
    if (status === "Failed")
      return <XCircle className="size-5 text-destructive" />;
    if (status === "Warning")
      return <AlertTriangle className="size-5 text-warning" />;
    if (status === "Queued")
      return <ListTodo className="size-5 text-muted-foreground" />;
    return <Loader2 className="size-5 text-info animate-spin" />;
  };

  return (
    <div
      className="relative flex flex-col h-full bg-background"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag Overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-4 border-dashed border-primary m-4 rounded-xl pointer-events-none">
          <div className="flex flex-col items-center">
            <UploadCloud className="size-24 text-primary animate-bounce mb-4" />
            <h2 className="text-3xl font-bold text-primary">Drop to Queue</h2>
            <p className="text-muted-foreground mt-2">
              PDF, DOCX, or LinkedIn URLs
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        {/* KPIs */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Candidates
                </CardTitle>
                <FileText className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats.totalCandidates}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Pending Review
                </CardTitle>
                <ListTodo className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-warning">
                  {stats.pendingReviews}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  New (Last 7 Days)
                </CardTitle>
                <UploadCloud className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-info">
                  +{stats.recentAdditions}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Processing Success
                </CardTitle>
                <CheckCircle className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-success">
                  {stats.tasksComplete + stats.tasksFailed > 0
                    ? Math.round(
                        (stats.tasksComplete /
                          (stats.tasksComplete + stats.tasksFailed)) *
                          100,
                      )
                    : 0}
                  %
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Charts */}
        {stats && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Pipeline Status */}
            <Card>
              <CardHeader>
                <CardTitle>Pipeline Status</CardTitle>
                <CardDescription>
                  Candidates grouped by current status
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-75 w-full">
                  <BarChart
                    data={stats.pipeline}
                    layout="vertical"
                    margin={{ top: 0, right: 0, left: 20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" />
                    <YAxis dataKey="status" type="category" width={100} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Job Types */}
            <Card>
              <CardHeader>
                <CardTitle>Job Types</CardTitle>
                <CardDescription>
                  Distribution of candidates across roles
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={chartConfig}
                  className="h-[300px] w-full"
                >
                  <BarChart
                    data={stats.jobTypes}
                    margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Velocity */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Recruitment Velocity</CardTitle>
                <CardDescription>
                  Candidates added over the last 30 days
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={chartConfig}
                  className="h-[300px] w-full"
                >
                  <AreaChart
                    data={stats.velocity}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="colorCount"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" />
                    <YAxis />
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey="count" stroke="var(--color-count)" fillOpacity={1} fill="url(#colorCount)" />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Queue Section Header */}
        <div className="flex items-center justify-between mt-12 pt-8 border-t">
          <div>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
              <UploadCloud className="size-6 text-primary" />
              Ingress Queue
            </h2>
            <p className="text-muted-foreground">
              Drop documents here to automatically parse and add them.
            </p>
          </div>
          <div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Clear Queue</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Are you sure you want to clear the queue?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all pending tasks. This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      await window.api.clearDocumentQueue();
                      loadTasks();
                    }}
                  >
                    Clear Queue
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Torrent-style Task List */}
        <div className="space-y-4">
          {tasks.length === 0 && !dragOver && (
            <div className="flex flex-col items-center justify-center h-48 border border-dashed rounded-lg text-muted-foreground space-y-4">
              <FileText className="size-10 opacity-50" />
              <p>No documents in queue.</p>
            </div>
          )}

          {tasks.map((task) => {
            const isError = task.status === "Failed";
            const isWarning = task.status === "Warning";
            const progress = getProgressPercentage(task.status);

            return (
              <Card
                key={task.id}
                className={`group relative transition-all ${isError ? "bg-destructive/5 border-destructive/20" : ""} ${isWarning ? "bg-warning/5 border-warning/20" : ""}`}
              >
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex items-center justify-between">
                    <div
                      className={`flex items-center gap-3 ${isError || isWarning || task.status !== "Complete" ? "cursor-default" : "cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-lg -mx-2 px-2 py-1 transition-colors"}`}
                      onClick={async () => {
                        if (task.status === "Complete" || isWarning) {
                          const res = await window.api.getCandidateByFilepath(
                            task.file_path,
                          );
                          if (res.success && res.id) {
                            navigate(`/cv-list?candidateId=${res.id}`);
                          }
                        }
                      }}
                    >
                      {getStatusIcon(task.status)}
                      <div className="flex flex-col">
                        <p className="text-sm font-medium leading-none mb-1">
                          {task.file_path.split(/[/\\]/).pop()}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {getHumanReadableStatus(task.status)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          isError
                            ? "destructive"
                            : task.status === "Complete" || isWarning
                              ? "default"
                              : "secondary"
                        }
                        className={`uppercase text-[10px] ${isWarning ? "bg-warning text-warning-foreground hover:bg-warning/80" : ""}`}
                      >
                        {task.status}
                      </Badge>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveTask(task.id);
                        }}
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
                      className={`h-2 ${isError ? "bg-destructive/20 [&>div]:bg-destructive" : ""} ${isWarning ? "bg-warning/20 [&>div]:bg-warning" : ""} ${task.status === "Complete" ? "[&>div]:bg-success" : ""}`}
                    />
                  </div>

                  {task.error_message && (
                    <p className={`text-sm p-2 rounded border ${isWarning ? "text-warning bg-warning/10 border-warning/20" : "text-destructive bg-destructive/10 border-destructive/20"}`}>
                      {task.error_message}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

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
            for (const path of pendingFilePaths) {
              await executeEnqueue(path);
            }
            setPendingFilePaths([]);
          }
        }}
      />
    </div>
  );
}
