import { useState, useEffect } from 'react'
import { Home, Users, Settings, ChevronLeft, ChevronRight, Loader2, UploadCloud } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Label } from '../ui/label'
import { useTaskQueue } from '../../contexts/TaskQueueContext'

interface MainLayoutProps {
  children: React.ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true'
  })

  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', isCollapsed.toString())
  }, [isCollapsed])

  const location = useLocation()
  const navigate = useNavigate()
  const { tasks, isDrawerOpen, setIsDrawerOpen } = useTaskQueue()

  const activeTasks = tasks.filter(t => t.status !== 'Complete' && t.status !== 'Failed' && t.status !== 'Warning').length

  const tabs = [
    { id: 'home', path: '/', label: 'Home', icon: Home },
    { id: 'cv-list', path: '/cv-list', label: 'Candidates', icon: Users },
    { id: 'settings', path: '/settings', label: 'Settings', icon: Settings }
  ] as const

  return (
    <div className="flex h-full bg-background text-foreground overflow-hidden">
      {/* Sidebar Navigation */}
      <nav className={`${isCollapsed ? 'w-20 items-center' : 'w-64'} transition-all duration-300 border-r border-border bg-card flex flex-col p-4 space-y-2 relative`}>

        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = location.pathname === tab.path || (tab.path === '/' && location.pathname === '')

          return (
            <button
              key={tab.id}
              onClick={() => navigate(tab.path)}
              className={`flex items-center gap-3 py-2.5 rounded-lg transition-colors text-sm font-medium ${isCollapsed ? 'justify-center px-0 w-12' : 'px-3 w-full'} ${isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              title={isCollapsed ? tab.label : undefined}
            >
              <Icon className="size-5 shrink-0" />
              {!isCollapsed && <span>{tab.label}</span>}
            </button>
          )
        })}

        <div className="flex-1" />
        
        {/* Queue Progress Indicator */}
        <button
          onClick={() => setIsDrawerOpen(!isDrawerOpen)}
          className={`flex items-center gap-3 py-2.5 rounded-lg transition-colors text-sm font-medium mb-2 ${isCollapsed ? 'justify-center px-0 w-12' : 'px-3 w-full'} ${activeTasks > 0 ? 'text-primary bg-primary/10 hover:bg-primary/20' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
          title="Task Queue"
        >
          {activeTasks > 0 ? <Loader2 className="size-5 shrink-0 animate-spin" /> : <UploadCloud className="size-5 shrink-0" />}
          {!isCollapsed && (
            <div className="flex items-center justify-between flex-1">
              <span>Queue</span>
              {tasks.length > 0 && (
                <span className="bg-background rounded-full px-2 py-0.5 text-xs font-bold border">
                  {activeTasks > 0 ? activeTasks : tasks.length}
                </span>
              )}
            </div>
          )}
        </button>

        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`flex items-center gap-3 py-2.5 rounded-lg transition-colors text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground ${isCollapsed ? 'justify-center px-0 w-12' : 'px-3 w-full'}`}
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isCollapsed ? <ChevronRight className="size-5 shrink-0" /> : <ChevronLeft className="size-5 shrink-0" />}
          {!isCollapsed && <span>Collapse Sidebar</span>}
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Unified Header */}
        <header className="px-8 py-6 shrink-0 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10">
          <Label className="text-3xl">
            {location.pathname === '/' && 'Dashboard'}
            {location.pathname === '/cv-list' && 'Candidates'}
            {location.pathname === '/settings' && 'Settings'}
          </Label>
          <p className="text-muted-foreground">
            {location.pathname === '/' && 'Process and extract data from CVs.'}
            {location.pathname === '/cv-list' && 'Manage and search through processed CVs.'}
            {location.pathname === '/settings' && 'Manage your application preferences and AI integrations.'}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
