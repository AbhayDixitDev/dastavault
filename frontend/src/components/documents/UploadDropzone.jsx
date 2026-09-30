import { useRef, useState } from 'react'
import { Camera, FolderOpen, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ACCEPTED_UPLOAD_TYPES } from '@/services/files'
import { cn } from '@/lib/utils'

/**
 * Big tap area to pick files. Supports drag-and-drop on desktop and a camera
 * button on phones (input capture="environment").
 */
export function UploadDropzone({ onFiles, disabled, className, compact = false }) {
  const inputRef = useRef(null)
  const cameraRef = useRef(null)
  const [over, setOver] = useState(false)

  const emit = (list) => {
    const files = Array.from(list || []).filter(Boolean)
    if (files.length) onFiles?.(files)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setOver(false)
    if (disabled) return
    emit(e.dataTransfer?.files)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-card text-center transition-colors',
        compact ? 'p-4' : 'p-8 sm:p-12',
        over ? 'border-primary bg-primary/5' : 'border-border',
        disabled && 'opacity-60',
        className,
      )}
    >
      <input ref={inputRef} type="file" multiple accept={ACCEPTED_UPLOAD_TYPES} className="hidden" onChange={(e) => { emit(e.target.files); e.target.value = '' }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { emit(e.target.files); e.target.value = '' }} />

      {!compact && (
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Upload className="size-7" />
        </span>
      )}
      <div>
        <p className="font-medium">{compact ? 'Add more files' : 'Drop files here or choose from your device'}</p>
        {!compact && <p className="mt-1 text-sm text-muted-foreground">Photos, PDFs, text, Word and Excel files. Up to 20 at a time.</p>}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" size={compact ? 'default' : 'lg'} onClick={() => inputRef.current?.click()} disabled={disabled}>
          <FolderOpen /> Choose files
        </Button>
        <Button type="button" size={compact ? 'default' : 'lg'} variant="outline" className="md:hidden" onClick={() => cameraRef.current?.click()} disabled={disabled}>
          <Camera /> Take a photo
        </Button>
      </div>
    </div>
  )
}
