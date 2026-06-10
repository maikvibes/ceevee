import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface MasterPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function MasterPasswordDialog({ open, onOpenChange, onSuccess }: MasterPasswordDialogProps) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasKeys, setHasKeys] = useState<boolean | null>(null)

  useEffect(() => {
    if (open && window.api.hasSavedKeys) {
      window.api.hasSavedKeys().then(res => {
        if (res.success) {
          setHasKeys(res.data || false)
        }
      })
    }
  }, [open])

  const isSetup = hasKeys === false

  const handleUnlock = async () => {
    if (!password.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await window.api.unlockKeystore(password)
      if (res.success) {
        setPassword('')
        onOpenChange(false)
        onSuccess()
      } else {
        setError(res.error || 'Failed to unlock keystore')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isSetup ? "Set Master Password" : "Unlock Keystore"}</DialogTitle>
          <DialogDescription>
            {isSetup 
              ? "Create a Master Password to secure your API keys. This will be required whenever you access or save keys in the future." 
              : "Enter your Master Password to decrypt your API keys. This unlocks the secure memory vault for this session."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Input
            id="password"
            type="password"
            placeholder="Master Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button disabled={loading} onClick={handleUnlock}>
            {loading ? 'Processing...' : (isSetup ? 'Set Password' : 'Unlock')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
