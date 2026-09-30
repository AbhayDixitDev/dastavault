import { useRef, useState } from 'react'
import { Camera, ImageIcon, Images } from 'lucide-react'
import { toast } from 'sonner'
import { useImageSearchMutation } from '@/store/api/searchApi'
import { prepareImageQuery } from '@/services/imageSearch'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { errorMessage } from '@/components/common/ErrorBox'
import { cn } from '@/lib/utils'

/**
 * "Search with a photo" button: take a photo or pick one, then find documents
 * that look like it. Calls `onResults(searchResponse, file)`.
 */
export function ImageSearchButton({ workspaceId, onResults, onStart, className, size = 'icon', variant = 'ghost' }) {
  const cameraRef = useRef(null)
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [imageSearch] = useImageSearchMutation()

  const handleFile = async (file) => {
    if (!file) return
    setBusy(true)
    onStart?.(file)
    const toastId = toast.loading('Looking at your photo...')
    try {
      const prep = await prepareImageQuery(file, { onStatus: (s) => toast.loading(s, { id: toastId }) })
      if (!prep.ok) {
        toast.error(prep.error, { id: toastId })
        return
      }
      toast.loading('Finding similar documents...', { id: toastId })
      const res = await imageSearch({ workspaceId, perceptual_hash: prep.perceptual_hash, text_sample: prep.text_sample }).unwrap()
      toast.success(res.results.length ? `Found ${res.results.length} similar document${res.results.length === 1 ? '' : 's'}.` : 'No similar documents found.', { id: toastId })
      onResults?.(res, file, prep)
    } catch (err) {
      toast.error(errorMessage(err), { id: toastId })
    } finally {
      setBusy(false)
      if (cameraRef.current) cameraRef.current.value = ''
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <span className={cn('inline-flex', className)}>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => handleFile(e.target.files?.[0])} />
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => handleFile(e.target.files?.[0])} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant={variant} size={size} disabled={busy} aria-label="Search with a photo" title="Search with a photo">
            {busy ? <Spinner size="sm" label="Searching" /> : <ImageIcon className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => cameraRef.current?.click()}>
            <Camera /> Take a photo
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileRef.current?.click()}>
            <Images /> Choose a photo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}
