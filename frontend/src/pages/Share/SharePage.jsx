import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Lock, Download, FileText, ChevronLeft, ChevronRight } from 'lucide-react'
import { API_URL } from '@/store/api/baseApi'
import { Logo } from '@/components/common/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'

/** Public, link-based document view. Served by the Worker after checking expiry and password. */
export function SharePage() {
  const { token } = useParams()
  const [state, setState] = useState({ status: 'loading' })
  const [password, setPassword] = useState('')
  const [page, setPage] = useState(0)

  const load = async (pw) => {
    setState({ status: 'loading' })
    try {
      const res = await fetch(`${API_URL}/api/shares/${token}`, { headers: pw ? { 'x-share-password': pw } : {} })
      const json = await res.json().catch(() => ({}))
      if (res.status === 401 && json.code === 'password_required') return setState({ status: 'password', wrong: Boolean(pw) })
      if (res.status === 410) return setState({ status: 'gone', message: 'This link has expired.' })
      if (!res.ok) return setState({ status: 'gone', message: json.error || 'This link is not valid.' })
      setState({ status: 'ready', data: json })
    } catch {
      setState({ status: 'gone', message: 'Cannot reach the server. Check your connection.' })
    }
  }

  useEffect(() => { load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const files = (state.data?.files ?? []).filter((f) => f.kind !== 'thumbnail')
  const current = files[page]
  const isImage = current?.mime_type?.startsWith('image/')
  const isPdf = current?.mime_type === 'application/pdf'

  return (
    <div className="min-h-svh bg-background bg-app-glow">
      <header className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-4">
        <Logo className="size-7" />
        <span className="font-display font-semibold">DastaVault</span>
        <span className="ml-auto text-xs text-muted-foreground">Shared document</span>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-12">
        {state.status === 'loading' && <div className="flex justify-center py-20"><Spinner className="size-6" /></div>}

        {state.status === 'password' && (
          <form
            onSubmit={(e) => { e.preventDefault(); load(password) }}
            className="mx-auto mt-10 max-w-sm rounded-2xl border bg-card p-6 shadow-lift"
          >
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Lock className="size-6" /></span>
            <h1 className="mt-3 font-display text-xl font-semibold">This link needs a password</h1>
            <p className="text-sm text-muted-foreground">Ask the person who shared it with you.</p>
            <div className="mt-4 grid gap-2">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              {state.wrong && <p className="text-sm text-destructive">That password is not right.</p>}
            </div>
            <Button type="submit" className="mt-4 w-full">Open</Button>
          </form>
        )}

        {state.status === 'gone' && (
          <div className="py-16">
            <EmptyState icon={FileText} title="This link does not work" description={state.message} />
          </div>
        )}

        {state.status === 'ready' && (
          <div className="mt-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="truncate font-display text-2xl font-semibold">{state.data.document?.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {files.length} {files.length === 1 ? 'file' : 'files'}
                </p>
              </div>
              {state.data.allow_download && current && (
                <Button asChild variant="outline">
                  <a href={current.download_url || current.url} download>
                    <Download /> Download
                  </a>
                </Button>
              )}
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-soft">
              {current ? (
                isImage ? (
                  <img src={current.url} alt="" className="mx-auto max-h-[75svh] w-auto object-contain" />
                ) : isPdf ? (
                  <iframe title="Document" src={current.url} className="h-[75svh] w-full" />
                ) : (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    Preview is not available for this file type.
                    {state.data.allow_download && <div className="mt-3"><Button asChild><a href={current.download_url || current.url}>Download it</a></Button></div>}
                  </div>
                )
              ) : (
                <div className="p-10 text-center text-sm text-muted-foreground">No files in this document.</div>
              )}
            </div>

            {files.length > 1 && (
              <div className="mt-3 flex items-center justify-center gap-3 text-sm">
                <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft /></Button>
                <span>{page + 1} of {files.length}</span>
                <Button variant="outline" size="icon" disabled={page >= files.length - 1} onClick={() => setPage((p) => p + 1)}><ChevronRight /></Button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
