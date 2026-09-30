import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, FileText, KeyRound, Send, Sparkles, User } from 'lucide-react'
import { motion } from 'motion/react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useAskDocumentsMutation, useGetAskKeyStatusQuery } from '@/store/api/ragApi'
import { embedQuery } from '@/services/search/embedding'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { Card, CardContent } from '@/components/ui/card'
import { errorMessage } from '@/components/common/ErrorBox'
import { cn } from '@/lib/utils'

const GENERAL_SUGGESTIONS = ["When does Dad's passport expire?", 'What is the invoice total?', 'Which insurance policies do we have?', 'What is my PAN number?']
const DOCUMENT_SUGGESTIONS = ['What is this document about?', 'When does it expire?', 'What are the important dates and numbers?', 'Who is this document for?']

function citationHref(workspaceId, source) {
  if (!source?.document_id) return null
  const page = source.page_number ? `?page=${source.page_number}` : ''
  return `/w/${workspaceId}/documents/${source.document_id}${page}`
}

/** Renders an answer, turning [n] markers into tappable citation chips. */
function AnswerText({ text, sources, workspaceId }) {
  const parts = useMemo(() => (text ?? '').split(/(\[\d+\])/g), [text])
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part)
        if (!m) return <span key={i}>{part}</span>
        const n = Number(m[1])
        const src = sources?.[n - 1]
        const href = citationHref(workspaceId, src)
        if (!href) return <span key={i}>{part}</span>
        return (
          <Link
            key={i}
            to={href}
            title={`${src.document_name ?? 'Document'}${src.page_number ? `, page ${src.page_number}` : ''}`}
            className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 align-middle text-[11px] font-semibold text-primary hover:bg-primary/25"
          >
            {n}
          </Link>
        )
      })}
    </p>
  )
}

function NeedsKeyCard({ workspaceId }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">
          <KeyRound className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Add an AI key in Settings to ask questions</p>
          <p className="text-sm text-muted-foreground">Everything else keeps working. Search does not need a key.</p>
        </div>
        <Button asChild size="sm">
          <Link to={`/w/${workspaceId}/settings/ai`}>Open Settings</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function SourcesList({ sources, workspaceId }) {
  if (!sources?.length) return null
  return (
    <div className="mt-2 flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">From your documents</p>
      <ul className="flex flex-col gap-1">
        {sources.map((s, i) => (
          <li key={s.chunk_id ?? `${s.document_id}-${i}`}>
            <Link to={citationHref(workspaceId, s) ?? '#'} className="flex items-start gap-2 rounded-lg border bg-card px-2 py-1.5 text-xs hover:bg-accent">
              <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 font-medium">
                  <FileText className="size-3" /> <span className="truncate">{s.document_name ?? 'Document'}</span>
                  {s.page_number ? <span className="text-muted-foreground">page {s.page_number}</span> : null}
                </span>
                {s.snippet && <span className="line-clamp-2 text-muted-foreground">{s.snippet}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * "Ask your documents" chat. Works on the Search page and inside a document
 * (pass `documentId` to limit answers to that document).
 */
export function AskPanel({ workspaceId: wsProp, documentId, className, compact = false, suggestions }) {
  const { workspaceId: wsFromRoute } = useWorkspace()
  const workspaceId = wsProp ?? wsFromRoute
  const [ask, { isLoading }] = useAskDocumentsMutation()
  const { data: keyStatus } = useGetAskKeyStatusQuery(undefined, { skip: !workspaceId })
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [thinking, setThinking] = useState('')
  const listRef = useRef(null)
  const inputRef = useRef(null)

  const chips = suggestions ?? (documentId ? DOCUMENT_SUGGESTIONS : GENERAL_SUGGESTIONS)
  const knownNoKey = keyStatus && keyStatus.hasKey === false
  const busy = isLoading || Boolean(thinking)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, thinking])

  const send = async (text) => {
    const q = (text ?? question).trim()
    if (!q || busy) return
    setQuestion('')
    const history = messages
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.answer))
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.role === 'user' ? m.content : m.answer }))
    setMessages((prev) => [...prev, { id: crypto.randomUUID?.() ?? String(Date.now()), role: 'user', content: q }])
    setThinking('Reading your documents...')
    const embedding = await embedQuery(q, { timeoutMs: 4000 })
    setThinking('Thinking...')
    try {
      const res = await ask({ workspaceId, question: q, embedding, document_id: documentId, history }).unwrap()
      setMessages((prev) => [...prev, { id: crypto.randomUUID?.() ?? String(Date.now()), role: 'assistant', answer: res.answer, sources: res.sources, not_found: res.not_found }])
    } catch (err) {
      const code = err?.data?.code ?? err?.code
      setMessages((prev) => [
        ...prev,
        code === 'ai_key_required'
          ? { id: String(Date.now()), role: 'assistant', needsKey: true }
          : { id: String(Date.now()), role: 'assistant', error: errorMessage(err) },
      ])
    } finally {
      setThinking('')
      inputRef.current?.focus()
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className={cn('flex flex-col rounded-2xl border bg-card', compact ? 'min-h-[18rem]' : 'min-h-[24rem]', className)}>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto scroll-inside p-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-6" />
            </span>
            <div>
              <p className="font-medium">Ask your documents</p>
              <p className="text-sm text-muted-foreground">{documentId ? 'Ask anything about this document.' : 'Ask in plain words. Answers come with the page they were found on.'}</p>
            </div>
            {knownNoKey ? (
              <div className="w-full max-w-md text-left">
                <NeedsKeyCard workspaceId={workspaceId} />
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                {chips.map((c) => (
                  <button key={c} type="button" onClick={() => send(c)} className="rounded-full border bg-background px-3 py-1.5 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 outline-none">
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m) => (
          <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className={cn('flex gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role !== 'user' && (
              <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="size-4" />
              </span>
            )}
            <div className={cn('max-w-[85%] rounded-2xl px-3 py-2', m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
              {m.role === 'user' && <p className="whitespace-pre-wrap text-sm">{m.content}</p>}
              {m.needsKey && <NeedsKeyCard workspaceId={workspaceId} />}
              {m.error && <p className="text-sm text-destructive">{m.error}</p>}
              {m.answer !== undefined && !m.needsKey && !m.error && (
                <>
                  <AnswerText text={m.answer} sources={m.sources} workspaceId={workspaceId} />
                  {!m.not_found && <SourcesList sources={m.sources} workspaceId={workspaceId} />}
                </>
              )}
            </div>
            {m.role === 'user' && (
              <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <User className="size-4" />
              </span>
            )}
          </motion.div>
        ))}

        {thinking && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
            <Spinner size="sm" label={thinking} /> {thinking}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        className="flex items-end gap-2 border-t p-3"
      >
        <Textarea
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={documentId ? 'Ask about this document' : 'Ask a question about your documents'}
          aria-label="Your question"
          className="min-h-11 max-h-32 resize-none"
        />
        <Button type="submit" size="icon-lg" disabled={!question.trim() || busy} aria-label="Send question">
          {busy ? <Spinner size="sm" /> : <Send className="size-4" />}
        </Button>
      </form>
    </div>
  )
}
