import { useState } from 'react'
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { AlertTriangle, Copy, Check, RefreshCw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Turns any thrown value into { title, reason, technical }. */
export function describeError(error) {
  if (isRouteErrorResponse(error)) {
    return {
      title: error.status === 404 ? 'Page not found' : 'Unexpected server reply',
      reason: error.status === 404 ? 'The link may be old or mistyped.' : `Status ${error.status}.`,
      technical: `HTTP ${error.status} ${error.statusText || ''}\n${typeof error.data === 'string' ? error.data : JSON.stringify(error.data ?? {}, null, 2)}`,
    }
  }
  const message = error?.message || String(error)
  let reason = 'This page could not be shown. Your documents are safe.'
  if (/network|fetch|failed to fetch|load/i.test(message)) reason = 'No connection to the server. Check the internet and try again.'
  else if (/not defined|undefined|null|is not a function|cannot read/i.test(message)) reason = 'A part of the app did not load. Reloading usually fixes it.'
  else if (/permission|forbidden|403/i.test(message)) reason = 'No permission to see this.'
  else if (/unauthorized|401|jwt|session/i.test(message)) reason = 'The session ended. Please sign in again.'
  const technical = [
    `${error?.name || 'Error'}: ${message}`,
    error?.stack || '',
    `Page: ${typeof window !== 'undefined' ? window.location.href : ''}`,
    `Time: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n')
  return { title: 'Something went wrong', reason, technical }
}

export function ErrorView({ error, onRetry }) {
  const { title, reason, technical } = describeError(error)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(technical)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background bg-app-glow px-4">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="size-7" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-muted-foreground">{reason}</p>

        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={onRetry ?? (() => window.location.reload())}>
            <RefreshCw /> Try again
          </Button>
          <Button asChild variant="outline">
            <Link to="/w">
              <Home /> Home
            </Link>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-6 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {open ? 'Hide details' : 'Show details'}
        </button>

        {open && (
          <div className="mt-3 rounded-xl border bg-card text-left shadow-soft">
            <div className="flex justify-end border-b px-2 py-1">
              <Button size="sm" variant="ghost" onClick={copy}>
                {copied ? <Check className="text-green-600" /> : <Copy />} {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <pre className="scroll-inside max-h-56 overflow-x-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-foreground/80">
              {technical}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

/** Route-level error element for React Router. */
export function RouteErrorPage() {
  const error = useRouteError()
  return <ErrorView error={error} />
}
