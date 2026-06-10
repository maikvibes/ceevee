import { SettingsAccordionItem } from '../components/settings/SettingsAccordionItem'
import { SettingsNestedRow } from '../components/settings/SettingsNestedRow'
import { Accordion } from '@/components/ui/accordion'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
} from "@/components/ui/alert-dialog"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useTheme } from '../components/theme-provider'
import { Brain, Palette, Link as LinkIcon, Shield, Check, ChevronsUpDown, Bot, Loader2 } from 'lucide-react'
import { SiAnthropic, SiOpenrouter, SiGooglegemini, SiMeta, SiMistralai, SiBaidu, SiNvidia, SiPerplexity, SiXiaomi, SiBytedance, SiMinimax, SiAlibabacloud } from '@icons-pack/react-simple-icons'
import { useEffect, useState, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MasterPasswordDialog } from '../components/settings/MasterPasswordDialog'
import { SecuredInput } from '../components/settings/SecuredInput'
import { Badge } from '@/components/ui/badge'
import { X, Tags } from 'lucide-react'
import { toast } from 'sonner'

const ProviderIcon = ({ provider, modelId, className }: { provider: string, modelId?: string, className?: string }) => {
  let effectiveProvider = provider
  if (provider === 'openrouter' && modelId && modelId.includes('/')) {
    effectiveProvider = modelId.split('/')[0].toLowerCase()
  }

  switch (effectiveProvider) {
    case 'openai': return <Bot className={className} />
    case 'anthropic': return <SiAnthropic className={className} />
    case 'openrouter': return <SiOpenrouter className={className} />
    case 'google':
    case 'gemini': return <SiGooglegemini className={className} />
    case 'meta-llama':
    case 'meta': return <SiMeta className={className} />
    case 'mistralai':
    case 'mistral': return <SiMistralai className={className} />
    case 'baidu': return <SiBaidu className={className} />
    case 'nvidia': return <SiNvidia className={className} />
    case 'perplexity': return <SiPerplexity className={className} />
    case 'xiaomi': return <SiXiaomi className={className} />
    case 'bytedance':
    case 'bytedance-seed': return <SiBytedance className={className} />
    case 'minimax': return <SiMinimax className={className} />
    case 'qwen': return <SiAlibabacloud className={className} />
    default: return <Brain className={className} />
  }
}

export function SettingsView() {
  const { theme, setTheme, colorTheme, setColorTheme, customStyle, setCustomStyle } = useTheme()
  const [provider, setProvider] = useState(() => localStorage.getItem('active_ai_provider') || 'openrouter')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<any[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [openCombobox, setOpenCombobox] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [saveStatus, setSaveStatus] = useState('')

  const filteredModels = useMemo(() => {
    if (!searchQuery) return models
    const lowerQuery = searchQuery.toLowerCase()
    return models.filter((m) =>
      m.name.toLowerCase().includes(lowerQuery) ||
      m.model_id.toLowerCase().includes(lowerQuery)
    )
  }, [models, searchQuery])

  const [parentEl, setParentEl] = useState<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: filteredModels.length,
    getScrollElement: () => parentEl,
    estimateSize: () => 32,
    overscan: 5,
  })

  const [notionKey, setNotionKey] = useState('')
  const [notionDb, setNotionDb] = useState('')
  const [notionAutoSync, setNotionAutoSync] = useState(false)
  const [notionSaveStatus, setNotionSaveStatus] = useState('')

  const [deleteConfirmationString, setDeleteConfirmationString] = useState('')
  const [deleteInputString, setDeleteInputString] = useState('')
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeletingAllData, setIsDeletingAllData] = useState(false)

  const [customTags, setCustomTags] = useState<any[]>([])
  const [newTag, setNewTag] = useState('')
  const [newJobType, setNewJobType] = useState('')

  useEffect(() => {
    localStorage.setItem('active_ai_provider', provider)
    loadProviderSettings()
  }, [provider])

  useEffect(() => {
    window.api.getSavedProviderSettings('notion').then((res: any) => {
      if (res.success && res.data) setNotionDb(res.data.model || '')
    })
    window.api.getAppSetting('notion_auto_sync').then((res: any) => {
      if (res.success) setNotionAutoSync(res.value === 'true')
    })
    loadTags()
  }, [])

  const loadTags = async () => {
    const res = await window.api.getCustomTags()
    if (res.success) {
      setCustomTags(res.data || [])
    }
  }

  const handleAddTag = async () => {
    if (!newTag.trim()) return
    const res = await window.api.addCustomTag({ name: newTag.trim(), category: 'Skill' })
    if (res.success) {
      setNewTag('')
      loadTags()
    }
  }

  const handleAddJobType = async () => {
    if (!newJobType.trim()) return
    const res = await window.api.addCustomTag({ name: newJobType.trim(), category: 'JobType' })
    if (res.success) {
      setNewJobType('')
      loadTags()
    }
  }

  const handleDeleteTag = async (id: number) => {
    const res = await window.api.deleteCustomTag(id)
    if (res.success) {
      loadTags()
    }
  }

  const loadProviderSettings = async () => {
    setIsLoadingModels(true)
    // Load models
    const res = await window.api.getModels(provider)
    if (res.success && res.data) {
      setModels(res.data)
    } else {
      setModels([])
    }

    // Load saved settings
    const settingsRes = await window.api.getSavedProviderSettings(provider)
    if (settingsRes.success && settingsRes.data) {
      setSelectedModel(settingsRes.data.model || '')
    } else {
      setSelectedModel('')
    }
    setIsLoadingModels(false)
  }

  const handleRefreshModels = async () => {
    setIsFetchingModels(true)
    const res = await window.api.fetchModels(provider)
    if (res.success) {
      await loadProviderSettings()
    } else {
      setSaveStatus(`Failed to fetch models: ${res.error}`)
    }
    setIsFetchingModels(false)
  }

  const handleSaveApiKey = async () => {
    setSaveStatus('Saving...')
    const isLocked = await window.api.isKeystoreLocked()
    if (isLocked) {
      setSaveStatus('')
      setShowPasswordDialog(true)
      return
    }

    await executeSaveKey()
  }

  const executeSaveKey = async () => {
    if (!apiKey.trim()) {
      setSaveStatus('Key cannot be empty')
      return
    }
    const res = await window.api.saveApiKey(provider, apiKey.trim(), selectedModel)
    if (res.success) {
      setSaveStatus('Saved securely!')
    } else {
      setSaveStatus(`Error: ${res.error}`)
    }
  }

  const handleSaveNotion = async () => {
    setNotionSaveStatus('Saving...')
    const isLocked = await window.api.isKeystoreLocked()
    if (isLocked) {
      setNotionSaveStatus('Unlock keystore to save')
      setShowPasswordDialog(true)
      return
    }

    if (!notionKey.trim()) {
      setNotionSaveStatus('Token cannot be empty')
      return
    }

    const res = await window.api.saveApiKey('notion', notionKey.trim(), notionDb.trim())
    await window.api.setAppSetting('notion_auto_sync', notionAutoSync.toString())

    if (res.success) {
      setNotionSaveStatus('Saved successfully!')
    } else {
      setNotionSaveStatus(`Error: ${res.error}`)
    }
  }

  const executeResetKeystore = async () => {
    const res = await window.api.resetKeystore()
    if (res.success) {
      window.dispatchEvent(new Event('keystore-reset'))
      toast.success("Keystore has been reset successfully.")
    } else {
      toast.error(`Failed to reset keystore: ${res.error}`)
    }
  }

  const handleOpenDeleteDialog = () => {
    setDeleteConfirmationString(Math.random().toString(36).substring(2, 8).toUpperCase())
    setDeleteInputString('')
    setIsDeleteDialogOpen(true)
  }

  const executeDeleteAllData = async () => {
    if (deleteInputString !== deleteConfirmationString) return
    setIsDeletingAllData(true)
    const res = await window.api.deleteAllData()
    setIsDeletingAllData(false)
    if (res.success) {
      toast.success("All data has been deleted successfully.")
      setIsDeleteDialogOpen(false)
    } else {
      toast.error(`Failed to delete data: ${res.error}`)
    }
  }

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto space-y-8 pb-12 w-full">

      <Accordion type="multiple" className="h-full">
        <SettingsAccordionItem
          value="item-taxonomy"
          icon={<Tags className="size-5" />}
          title="System Taxonomy"
          subtitle="Manage the tags and job types available for the candidate pipeline"
        >
          <div className="grid grid-cols-2 gap-12 p-6 w-full">
            {/* Skills Section */}
            <div className="flex flex-col gap-4 border-r border-border pr-12">
              <Label className="text-sm font-semibold text-foreground tracking-tight">Skills</Label>
              <div className="flex gap-3 w-full">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Add skill (e.g. React)"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                  className="h-9 text-sm"
                />
                <Button onClick={handleAddTag} variant="secondary" size="sm" className="h-9">Add</Button>
              </div>
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-2 mt-1">
                {customTags.filter(t => t.category === 'Skill').map(tag => (
                  <Badge key={tag.id} variant="outline" className="flex items-center gap-1.5 bg-background py-1">
                    {tag.name}
                    <span className="cursor-pointer hover:text-destructive transition-colors text-muted-foreground" onClick={() => handleDeleteTag(tag.id)}>
                      <X className="size-3" />
                    </span>
                  </Badge>
                ))}
              </div>
            </div>

            {/* Job Types Section */}
            <div className="flex flex-col gap-4 pl-2">
              <Label className="text-sm font-semibold text-foreground tracking-tight">Job Types</Label>
              <div className="flex gap-3 w-full">
                <Input
                  value={newJobType}
                  onChange={(e) => setNewJobType(e.target.value)}
                  placeholder="Add Job Type"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddJobType()}
                  className="h-9 text-sm"
                />
                <Button onClick={handleAddJobType} variant="secondary" size="sm" className="h-9">Add</Button>
              </div>
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-2 mt-1">
                {customTags.filter(t => t.category === 'JobType').map(tag => (
                  <Badge key={tag.id} variant="outline" className="flex items-center gap-1.5 bg-background border-info/30 text-info py-1">
                    {tag.name}
                    <span className="cursor-pointer hover:text-destructive transition-colors opacity-70 hover:opacity-100" onClick={() => handleDeleteTag(tag.id)}>
                      <X className="size-3" />
                    </span>
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </SettingsAccordionItem>

        <SettingsAccordionItem
          value="item-appearance"
          icon={<Palette className="size-5" />}
          title="Appearance"
          subtitle="Customize the look and feel of the app"
        >
          <SettingsNestedRow label="Theme Mode">
            <div className="flex items-center gap-2">
              <Button
                variant={theme === 'light' ? 'default' : 'outline'}
                onClick={() => setTheme('light')}
                size="sm"
              >
                Light
              </Button>
              <Button
                variant={theme === 'dark' ? 'default' : 'outline'}
                onClick={() => setTheme('dark')}
                size="sm"
              >
                Dark
              </Button>
              <Button
                variant={theme === 'system' ? 'default' : 'outline'}
                onClick={() => setTheme('system')}
                size="sm"
              >
                System
              </Button>
            </div>
          </SettingsNestedRow>

          <SettingsNestedRow label="Active Theme">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                {([
                  { id: 'default', label: 'Default Shadcn', bg: 'bg-zinc-900 dark:bg-zinc-50' },
                  { id: 'sage_green', label: 'Sage Green', bg: 'bg-[#5b7365]' },
                  { id: 'warm', label: 'Warm', bg: 'bg-[#b6532d]' },
                  { id: 'custom', label: 'Custom (TweakCN)', bg: 'bg-gradient-to-tr from-primary to-info' },
                ] as const).map((color) => (
                  <button
                    key={color.id}
                    onClick={() => setColorTheme(color.id as any)}
                    className={`w-10 h-10 rounded-full border-2 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${color.bg} ${colorTheme === color.id ? 'border-primary ring-2 ring-primary ring-offset-2' : 'border-transparent'
                      }`}
                    title={color.label}
                  />
                ))}
              </div>

              {colorTheme === 'custom' && (
                <div className="flex flex-col gap-2 w-full max-w-[400px]">
                  <p className="text-xs text-muted-foreground">
                    Paste the CSS variables string generated from tweakcn.com below.
                  </p>
                  <Textarea
                    placeholder=":root { ... }"
                    value={customStyle}
                    onChange={(e) => setCustomStyle(e.target.value)}
                    className="min-h-[150px] font-mono text-xs"
                  />
                </div>
              )}
            </div>
          </SettingsNestedRow>
        </SettingsAccordionItem>

        <SettingsAccordionItem
          value="item-ai"
          icon={<Brain className="size-5" />}
          title="AI Provider Settings"
          subtitle="Choose the AI engine and API keys for processing CVs"
        >
          <SettingsNestedRow label="Active Provider">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">
                  <div className="flex items-center gap-2">
                    <ProviderIcon provider="openai" className="size-4" />
                    OpenAI
                  </div>
                </SelectItem>
                <SelectItem value="anthropic">
                  <div className="flex items-center gap-2">
                    <ProviderIcon provider="anthropic" className="size-4" />
                    Anthropic
                  </div>
                </SelectItem>
                <SelectItem value="openrouter">
                  <div className="flex items-center gap-2">
                    <ProviderIcon provider="openrouter" className="size-4" />
                    OpenRouter
                  </div>
                </SelectItem>
                <SelectItem value="gemini">
                  <div className="flex items-center gap-2">
                    <ProviderIcon provider="gemini" className="size-4" />
                    Gemini
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsNestedRow>
          <SettingsNestedRow label="API Key">
            <div className="flex flex-col gap-2 w-72">
              <SecuredInput
                provider={provider}
                value={apiKey}
                onChange={setApiKey}
                placeholder="sk-..."
              />
            </div>
          </SettingsNestedRow>
          <SettingsNestedRow label="AI Model" alignTop>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={openCombobox}
                      disabled={isLoadingModels}
                      className="w-[280px] justify-between font-normal"
                    >
                      <span className="flex items-center truncate">
                        {isLoadingModels ? (
                          <span className="flex items-center text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading models...
                          </span>
                        ) : selectedModel ? (
                          <>
                            <ProviderIcon provider={provider} modelId={selectedModel} className="mr-2 size-4 opacity-70" />
                            {models.find((m) => m.model_id === selectedModel)?.name || selectedModel}
                          </>
                        ) : (
                          "Select a model..."
                        )}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-0">
                    <Command shouldFilter={false}>
                      <CommandInput placeholder="Search models..." value={searchQuery} onValueChange={setSearchQuery} />
                      <CommandList ref={setParentEl}>
                        {filteredModels.length === 0 && <CommandEmpty>No model found.</CommandEmpty>}
                        <CommandGroup>
                          <div
                            style={{
                              height: `${rowVirtualizer.getTotalSize()}px`,
                              width: '100%',
                              position: 'relative',
                            }}
                          >
                            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                              const m = filteredModels[virtualRow.index]
                              return (
                                <CommandItem
                                  key={m.model_id}
                                  value={`${m.name} ${m.model_id}`} // allow searching by name or id
                                  onSelect={() => {
                                    setSelectedModel(m.model_id)
                                    setOpenCombobox(false)
                                  }}
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${virtualRow.size}px`,
                                    transform: `translateY(${virtualRow.start}px)`,
                                  }}
                                >
                                  <div className="flex items-center truncate">
                                    <ProviderIcon provider={provider} modelId={m.model_id} className="mr-2 size-4 opacity-50 flex-shrink-0" />
                                    <span className="truncate">{m.name}</span>
                                  </div>
                                  <Check
                                    className={`ml-auto h-4 w-4 flex-shrink-0 ${
                                      selectedModel === m.model_id ? "opacity-100" : "opacity-0"
                                    }`}
                                  />
                                </CommandItem>
                              )
                            })}
                          </div>
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Button variant="outline" size="sm" onClick={handleRefreshModels} disabled={isFetchingModels}>
                  {isFetchingModels ? 'Fetching...' : 'Fetch List'}
                </Button>
              </div>

              <div className="flex items-center gap-4 mt-2">
                <Button onClick={handleSaveApiKey} variant="secondary">Save Provider Configuration</Button>
                {saveStatus && <span className="text-sm text-muted-foreground">{saveStatus}</span>}
              </div>
            </div>
          </SettingsNestedRow>
        </SettingsAccordionItem>

        <SettingsAccordionItem
          value="item-notion"
          icon={<LinkIcon className="size-5" />}
          title="Notion Integration"
          subtitle="Sync candidate profiles directly to a Notion Database"
        >
          <SettingsNestedRow label="Integration Token">
            <div className="w-72">
              <SecuredInput
                provider="notion"
                value={notionKey}
                onChange={setNotionKey}
                placeholder="secret_..."
              />
            </div>
          </SettingsNestedRow>
          <SettingsNestedRow label="Database ID">
            <Input
              type="text"
              placeholder="e.g. abc123def456..."
              className="w-64"
              value={notionDb}
              onChange={(e) => setNotionDb(e.target.value)}
            />
          </SettingsNestedRow>
          <SettingsNestedRow label="Auto-Sync">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoSync"
                checked={notionAutoSync}
                onChange={(e) => setNotionAutoSync(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <Label htmlFor="autoSync" className="cursor-pointer">Automatically sync newly added candidates</Label>
            </div>
          </SettingsNestedRow>
          <SettingsNestedRow label="" alignTop>
            <div className="flex items-center gap-4 mt-2">
              <Button onClick={handleSaveNotion} variant="secondary">Save Notion Configuration</Button>
              {notionSaveStatus && <span className="text-sm text-muted-foreground">{notionSaveStatus}</span>}
            </div>
          </SettingsNestedRow>
        </SettingsAccordionItem>

        <SettingsAccordionItem
          value="item-security"
          icon={<Shield className="size-5" />}
          title="Security & Data"
          subtitle="Manage your master password and secure keystore"
        >
          <SettingsNestedRow label="Reset Keystore" alignTop>
            <div className="flex flex-col gap-3 max-w-[400px]">
              <p className="text-sm text-muted-foreground leading-relaxed">
                This will permanently delete all saved API keys and reset your Master Password. You will need to re-enter your keys and choose a new Master Password.
              </p>
              <div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      Reset Keystore
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete your Master Password and all encrypted API keys from the secure vault. You will have to re-enter all your keys.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={executeResetKeystore} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Yes, reset keystore
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </SettingsNestedRow>
          
          <div className="h-px bg-border my-2 mx-6" />

          <SettingsNestedRow label="Delete All Data" alignTop>
            <div className="flex flex-col gap-3 max-w-[400px]">
              <p className="text-sm text-muted-foreground leading-relaxed">
                This will permanently delete all parsed candidates, documents, and synchronization history. Your settings and API keys will be preserved.
              </p>
              <div>
                <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" onClick={handleOpenDeleteDialog}>
                      Delete All Data
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete all your candidate data.
                      </AlertDialogDescription>
                      <div className="mt-4 flex flex-col gap-2">
                        <Label className="text-foreground">
                          Type <strong className="select-none bg-muted px-1.5 py-0.5 rounded text-destructive">{deleteConfirmationString}</strong> to confirm.
                        </Label>
                        <Input 
                          value={deleteInputString}
                          onChange={(e) => setDeleteInputString(e.target.value.toUpperCase())}
                          placeholder="Enter confirmation string"
                        />
                      </div>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <Button 
                        variant="destructive" 
                        onClick={executeDeleteAllData} 
                        disabled={deleteInputString !== deleteConfirmationString || isDeletingAllData}
                      >
                        {isDeletingAllData ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting...</> : "Yes, delete all data"}
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </SettingsNestedRow>
        </SettingsAccordionItem>

      </Accordion>

      <MasterPasswordDialog
        open={showPasswordDialog}
        onOpenChange={setShowPasswordDialog}
        onSuccess={executeSaveKey}
      />
    </div>
  )
}
