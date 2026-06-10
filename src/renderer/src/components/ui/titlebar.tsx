import { Minus, Square, X } from 'lucide-react'

const CeeveeLogo = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 600 600" version="1.1" xmlns="http://www.w3.org/2000/svg" style={{fillRule:'evenodd',clipRule:'evenodd',strokeLinejoin:'round',strokeMiterlimit:2}}>
      <g transform="matrix(0,-0.509804,0.509804,0,122.753267,471.676652)">
          <path fill="currentColor" d="M28.852,655.574L28.852,247.502C28.852,132.856 121.93,39.778 236.576,39.778L644.648,39.778L644.648,447.851C644.648,562.496 551.57,655.574 436.925,655.574L28.852,655.574ZM200.26,484.167L200.26,303.269C200.26,252.447 241.521,211.186 292.343,211.186L473.241,211.186L473.241,207.917C473.241,157.094 431.98,115.833 381.157,115.833L196.991,115.833C146.169,115.833 104.907,157.094 104.907,207.917L104.907,392.083C104.907,442.906 146.169,484.167 196.991,484.167L200.26,484.167ZM473.241,211.186L473.241,392.083C473.241,442.906 431.98,484.167 381.157,484.167L200.26,484.167L200.26,487.436C200.26,538.258 241.521,579.519 292.343,579.519L476.51,579.519C527.332,579.519 568.593,538.258 568.593,487.436L568.593,303.269C568.593,252.447 527.332,211.186 476.51,211.186L473.241,211.186Z"/>
      </g>
  </svg>
)

export function Titlebar() {
  const handleMinimize = () => window.api.minimizeWindow()
  const handleMaximize = () => window.api.maximizeWindow()
  const handleClose = () => window.api.closeWindow()

  return (
    <div 
      className="flex items-center justify-between h-10 w-full bg-background border-b border-border select-none shrink-0" 
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="flex items-center gap-2.5 pl-4">
        <CeeveeLogo className="w-5 h-5 text-primary opacity-90" />
        <span className="text-sm font-bold tracking-wide text-foreground">Ceevee</span>
      </div>

      <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <button
          onClick={handleMinimize}
          className="flex items-center justify-center h-full w-11 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground outline-none"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex items-center justify-center h-full w-11 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground outline-none"
        >
          <Square className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleClose}
          className="flex items-center justify-center h-full w-11 hover:bg-destructive hover:text-destructive-foreground transition-colors text-muted-foreground outline-none"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
