import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { toast } from 'sonner'
import { isVoiceSupported, startListening } from '@/services/search/voice'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Microphone button. While listening the mic pulses and the recognised text
 * shows live in a small panel under the button. Calls `onResult(text)` when
 * the person stops talking.
 */
export function VoiceSearchButton({ onResult, onInterim, lang = 'en-IN', className, size = 'icon', variant = 'ghost', autoSubmit = true }) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [supported] = useState(() => isVoiceSupported())
  const handleRef = useRef(null)

  useEffect(() => () => handleRef.current?.stop(), [])

  const stop = () => {
    handleRef.current?.stop()
  }

  const start = async () => {
    if (!supported) {
      toast.info('Voice search is not available in this browser.')
      return
    }
    if (listening) {
      stop()
      return
    }
    setInterim('')
    setListening(true)
    const handle = startListening({
      lang,
      onInterim: (t) => {
        setInterim(t)
        onInterim?.(t)
      },
    })
    handleRef.current = handle
    const res = await handle.promise
    handleRef.current = null
    setListening(false)
    if (res.ok && res.transcript) {
      setInterim(res.transcript)
      onResult?.(res.transcript, { autoSubmit })
      setTimeout(() => setInterim(''), 300)
    } else {
      setInterim('')
      if (res.error && res.code !== 'aborted') toast.error(res.error)
    }
  }

  return (
    <span className={cn('relative inline-flex', className)}>
      <Button
        type="button"
        variant={listening ? 'default' : variant}
        size={size}
        onClick={start}
        aria-pressed={listening}
        aria-label={listening ? 'Stop listening' : supported ? 'Search by voice' : 'Voice search is not available in this browser'}
        title={supported ? 'Search by voice' : 'Voice search is not available in this browser'}
        className={cn('relative', listening && 'rounded-full')}
      >
        {listening && (
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-primary/40"
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: [1, 1.7, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        {listening ? <Square className="relative size-4" /> : <Mic className="relative size-4" />}
      </Button>

      <AnimatePresence>
        {listening && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border bg-popover p-3 text-sm shadow-lift"
          >
            <p className="flex items-center gap-2 text-xs font-medium text-primary">
              <motion.span className="size-2 rounded-full bg-primary" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }} />
              Listening... speak now
            </p>
            <p className={cn('mt-1 min-h-5 break-words', !interim && 'text-muted-foreground')}>{interim || 'Say a name, a document type or a year.'}</p>
            <Button type="button" size="sm" variant="outline" className="mt-2 w-full" onClick={stop}>
              Done
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  )
}
