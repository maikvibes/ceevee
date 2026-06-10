import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Label } from "@/components/ui/label"

interface SettingsAccordionItemProps {
  value: string
  icon: React.ReactNode
  title: string
  subtitle?: string
  children: React.ReactNode
}

export function SettingsAccordionItem({ value, icon, title, subtitle, children }: SettingsAccordionItemProps) {
  return (
    <AccordionItem value={value} className="bg-card rounded-lg border border-border overflow-hidden mb-2 px-0">
      <AccordionTrigger className="w-full flex items-center justify-between p-4 hover:bg-accent transition-colors hover:no-underline data-[state=open]:border-b data-[state=open]:border-border">
        <div className="flex items-center gap-4">
          <div className="text-muted-foreground">
            {icon}
          </div>
          <div className="text-left">
            <Label className="text-sm font-medium text-card-foreground cursor-pointer">{title}</Label>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
      </AccordionTrigger>
      
      <AccordionContent className="bg-background pb-0">
        {children}
      </AccordionContent>
    </AccordionItem>
  )
}
