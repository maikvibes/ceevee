import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff, Lock, Unlock } from 'lucide-react'
import { MasterPasswordDialog } from './MasterPasswordDialog'
import { toast } from 'sonner'

interface SecuredInputProps {
  provider: string
  value: string
  onChange: (val: string) => void
  onUserChange?: (value: string) => void
  onUnlocked?: () => void
  placeholder?: string
  className?: string
}

export function SecuredInput({ provider, value, onChange, onUserChange, onUnlocked, placeholder, className }: SecuredInputProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [isLocked, setIsLocked] = useState(true)
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    const id = ++requestId.current
    onChange('')
    setShowPassword(false)
    void (async () => {
      const locked = await window.api.isKeystoreLocked()
      if (id !== requestId.current) return
      setIsLocked(locked)
      if (!locked) await loadKey(id)
    })()
    return () => { requestId.current++ }
  }, [provider])

  useEffect(() => {
    const handleReset = () => {
      requestId.current++
      setIsLocked(true)
      onChange('')
      setShowPassword(false)
    }
    window.addEventListener('keystore-reset', handleReset)
    return () => window.removeEventListener('keystore-reset', handleReset)
  }, [onChange])

  const loadKey = async (id = requestId.current) => {
    if (!window.api.getApiKey) return
    try {
      const res = await window.api.getApiKey(provider)
      if (id === requestId.current && res?.success) onChange(res.data || '')
    } catch (e) {
      console.error("Failed to load key:", e)
    }
  }

  const handleUnlock = async () => {
    const locked = await window.api.isKeystoreLocked()
    if (locked) {
      setShowPasswordDialog(true)
    } else {
      setIsLocked(false)
      loadKey()
      onUnlocked?.()
    }
  }

  const onPasswordSuccess = () => {
    setShowPasswordDialog(false)
    setIsLocked(false)
    loadKey()
    onUnlocked?.()
  }

  const executeLock = async () => {
    if (!window.api.lockKeystore) {
      toast.error("Please restart your app. The new lockKeystore backend handler is not loaded.")
      return
    }
    try {
      const res = await window.api.lockKeystore()
      if (res.success) {
        setIsLocked(true)
        requestId.current++
        onChange('')
        setShowPassword(false)
      } else {
        toast.error("Failed to lock keystore: " + res.error)
      }
    } catch (e) {
      toast.error("Error locking keystore: " + e)
    }
  }

  return (
    <div className="flex gap-2 items-center">
      <div className="relative w-full">
        <Input
          type={isLocked || !showPassword ? "password" : "text"}
          value={isLocked ? "Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢" : value}
          onChange={(e) => {
            if (!isLocked) {
              requestId.current++
              onChange(e.target.value)
              onUserChange?.(e.target.value)
            }
          }}
          disabled={isLocked}
          placeholder={placeholder}
          className={`pr-10 ${className || ''} ${isLocked ? 'cursor-not-allowed opacity-70' : ''}`}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      
      {isLocked ? (
        <Button onClick={handleUnlock} variant="outline" size="icon" title="Unlock to load existing key" className="flex-shrink-0">
          <Lock className="size-4 text-muted-foreground" />
        </Button>
      ) : (
        <Button onClick={executeLock} variant="outline" size="icon" title="Lock keystore and hide key" className="flex-shrink-0 text-success hover:text-destructive hover:border-destructive hover:bg-destructive/10 transition-colors">
          <Unlock className="size-4" />
        </Button>
      )}

      {showPasswordDialog && (
        <MasterPasswordDialog
          open={showPasswordDialog}
          onOpenChange={setShowPasswordDialog}
          onSuccess={onPasswordSuccess}
        />
      )}
    </div>
  )
}
