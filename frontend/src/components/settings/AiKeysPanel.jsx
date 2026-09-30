import { useState } from 'react'
import { Activity, KeyRound, Plus, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useCreateAiKeyMutation, useDeleteAiKeyMutation, useGetAiKeysQuery, useTestAiKeyMutation } from '@/store/api/aiApi'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'
import { formatDate } from '@/utils/format'

export const AI_PROVIDERS = [
  { key: 'openai', label: 'OpenAI', model: 'gpt-4o-mini', keyHint: 'sk-...' },
  { key: 'gemini', label: 'Google Gemini', model: 'gemini-1.5-flash', keyHint: 'AIza...' },
  { key: 'anthropic', label: 'Anthropic', model: 'claude-3-5-haiku-latest', keyHint: 'sk-ant-...' },
  { key: 'groq', label: 'Groq', model: 'llama-3.1-8b-instant', keyHint: 'gsk_...' },
  { key: 'local', label: 'Local (Ollama, LM Studio)', model: 'llama3', keyHint: 'any text if the server needs none', baseUrl: 'http://localhost:11434/v1' },
  { key: 'custom', label: 'Custom (OpenAI compatible)', model: '', keyHint: 'API key', baseUrl: 'https://' },
]

function providerOf(key) {
  return AI_PROVIDERS.find((p) => p.key === key) || AI_PROVIDERS[AI_PROVIDERS.length - 1]
}

/** Settings > AI: the user's own AI keys for "Ask your documents". */
export function AiKeysPanel() {
  const { data: keys = [], isLoading, error, refetch } = useGetAiKeysQuery()
  const [deleteKey] = useDeleteAiKeyMutation()
  const [testKey] = useTestAiKeyMutation()
  const [addOpen, setAddOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [testing, setTesting] = useState({}) // id -> true | { ok, model, latency_ms, error }

  const onTest = async (k) => {
    setTesting((t) => ({ ...t, [k.id]: true }))
    try {
      const r = await testKey(k.id).unwrap()
      setTesting((t) => ({ ...t, [k.id]: r }))
    } catch (err) {
      setTesting((t) => ({ ...t, [k.id]: { ok: false, error: errorMessage(err) } }))
    }
  }

  const onRemove = async () => {
    try {
      await deleteKey(removeTarget.id).unwrap()
      toast.success('Key removed.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRemoveTarget(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>AI keys</CardTitle>
          <CardDescription>
            Add your own key to ask questions about your documents. Your key is stored encrypted and only used when you ask a question.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && <ErrorBox error={error} onRetry={refetch} />}
          {isLoading ? (
            <>
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </>
          ) : keys.length === 0 ? (
            <EmptyState icon={KeyRound} title="No AI key yet" description="Without a key, questions are answered with simple search only." action={<Button onClick={() => setAddOpen(true)}><Plus /> Add key</Button>} />
          ) : (
            <ul className="flex flex-col gap-2">
              {keys.map((k) => {
                const t = testing[k.id]
                return (
                  <li key={k.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
                    <Badge variant="secondary">{providerOf(k.provider).label}</Badge>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-medium">
                        <span className="truncate">{k.label || providerOf(k.provider).label}</span>
                        {k.is_default && <Star className="size-3.5 fill-brand-amber text-brand-amber" aria-label="Default" />}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {k.model || 'default model'}{k.base_url ? ` · ${k.base_url}` : ''} · added {formatDate(k.created_at)}
                      </span>
                      {t && t !== true && (
                        <span className={t.ok ? 'text-xs text-brand-teal' : 'text-xs text-destructive'}>
                          {t.ok ? `Works. ${t.model || ''} answered in ${t.latency_ms} ms` : `Failed: ${t.error || 'no answer'}`}
                        </span>
                      )}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => onTest(k)} disabled={t === true}>
                      {t === true ? <Spinner size="sm" /> : <Activity />} Test
                    </Button>
                    <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label="Remove key" onClick={() => setRemoveTarget(k)}>
                      <Trash2 />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          {keys.length > 0 && (
            <div>
              <Button variant="outline" onClick={() => setAddOpen(true)}>
                <Plus /> Add key
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AddKeyDialog open={addOpen} onOpenChange={setAddOpen} firstKey={keys.length === 0} />

      <AlertDialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this key?</AlertDialogTitle>
            <AlertDialogDescription>Questions will stop using it. You can add it again later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={onRemove} className="bg-destructive text-white hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function AddKeyDialog({ open, onOpenChange, firstKey }) {
  const [createKey, { isLoading }] = useCreateAiKeyMutation()
  const [provider, setProvider] = useState('openai')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(providerOf('openai').model)
  const [baseUrl, setBaseUrl] = useState('')
  const [label, setLabel] = useState('')
  const [isDefault, setIsDefault] = useState(true)
  const p = providerOf(provider)
  const needsUrl = provider === 'local' || provider === 'custom'

  const pickProvider = (key) => {
    const np = providerOf(key)
    setProvider(key)
    setModel(np.model)
    setBaseUrl(np.baseUrl || '')
  }

  const close = (v) => {
    if (!v) {
      setApiKey('')
      setLabel('')
    }
    onOpenChange(v)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!apiKey.trim()) return toast.error('Paste the key first.')
    if (needsUrl && !baseUrl.trim()) return toast.error('Enter the server address.')
    try {
      await createKey({
        provider,
        api_key: apiKey.trim(),
        label: label.trim() || undefined,
        model: model.trim() || undefined,
        base_url: needsUrl ? baseUrl.trim() : undefined,
        is_default: firstKey ? true : isDefault,
      }).unwrap()
      toast.success('Key added.')
      close(false)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Add AI key</DialogTitle>
            <DialogDescription>Your key is stored encrypted and only used when you ask a question.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-4 py-1">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ai-provider">Provider</Label>
                <Select value={provider} onValueChange={pickProvider}>
                  <SelectTrigger id="ai-provider" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AI_PROVIDERS.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {needsUrl && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ai-url">Server address</Label>
                  <Input id="ai-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" inputMode="url" />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ai-key">API key</Label>
                <Input id="ai-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={p.keyHint} autoComplete="off" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ai-model">Model</Label>
                <Input id="ai-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ai-label">Label (optional)</Label>
                <Input id="ai-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Work key, Personal..." />
              </div>
              {!firstKey && (
                <label className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm">
                  Use this key by default
                  <Switch checked={isDefault} onCheckedChange={setIsDefault} />
                </label>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>{isLoading && <Spinner size="sm" />} Add key</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default AiKeysPanel
