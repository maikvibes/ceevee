import { useEffect, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { ListTodo, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export function TaskQueueSheet() {
  const [isOpen, setIsOpen] = useState(false)
  const [tasks, setTasks] = useState<any[]>([])

  useEffect(() => {
    if (isOpen) {
      loadTasks()
    }
  }, [isOpen])

  useEffect(() => {
    window.api.onDocumentProgress(() => {
      if (isOpen) {
        loadTasks()
      }
    })
  }, [isOpen])

  const loadTasks = async () => {
    const data = await window.api.getDocumentTasks()
    setTasks(data || [])
  }

  const getStatusIcon = (status: string) => {
    if (status === 'Complete') return <CheckCircle className="size-4 text-success" />
    if (status === 'Failed') return <XCircle className="size-4 text-destructive" />
    if (status === 'Queued') return <ListTodo className="size-4 text-muted-foreground" />
    return <Loader2 className="size-4 text-info animate-spin" />
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="w-full justify-start mt-4">
          <ListTodo className="mr-2 size-4" />
          Queue
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Processing Queue</SheetTitle>
          <SheetDescription>
            Live status of CV extraction and AI processing.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 flex flex-col gap-4 overflow-y-auto max-h-[80vh] pr-4">
          {tasks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center mt-8">No tasks in the queue.</p>
          )}
          {tasks.map((task) => (
            <div key={task.id} className="flex flex-col gap-2 p-3 border border-border rounded-lg bg-card">
              <div className="flex justify-between items-start">
                <span className="text-xs font-mono text-muted-foreground break-all">
                  {task.file_path.split(/[\\/]/).pop()}
                </span>
                {getStatusIcon(task.status)}
              </div>
              <div className="flex items-center justify-between mt-2">
                <Badge variant="secondary" className="text-[10px] uppercase">
                  {task.status}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(task.created_at).toLocaleTimeString()}
                </span>
              </div>
              {task.error_message && (
                <p className="text-xs text-destructive mt-1">{task.error_message}</p>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
