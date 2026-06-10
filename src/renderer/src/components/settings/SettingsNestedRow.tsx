import { Label } from '@/components/ui/label'

interface SettingsNestedRowProps {
  label: string
  alignTop?: boolean
  children: React.ReactNode
}

export function SettingsNestedRow({ label, alignTop = false, children }: SettingsNestedRowProps) {
  return (
    <div className="flex items-center justify-between p-4 border-b border-border border-b-0 hover:bg-accent transition-colors">
      <Label className={`text-sm ${alignTop ? 'self-start mt-2' : ''}`}>
        {label}
      </Label>
      <div className="flex items-center">
        {children}
      </div>
    </div>
  )
}
