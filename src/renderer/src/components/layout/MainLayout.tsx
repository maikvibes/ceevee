import { useState } from 'react'
import { Home, Users, Settings, ChevronLeft, ChevronRight } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Label } from '../ui/label'

interface MainLayoutProps {
  children: React.ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
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
