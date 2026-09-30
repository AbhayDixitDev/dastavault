import { useEffect, useRef, useState } from 'react'
import { useSignedUrl } from '@/services/files/signedUrls'
import { cn } from '@/lib/utils'

/**
 * <img> that asks for a signed URL when it scrolls into view. Nothing is stored
 * in Redux; the URL lives in a small in-memory cache. Renders `fallback` while
 * loading or when the file cannot be shown.
 */
export function SignedImage({ workspaceId, fileId, alt = '', className, imgClassName, fallback = null, eager = false, onLoad }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(eager)
  const [broken, setBroken] = useState(false)
  const { url } = useSignedUrl(workspaceId, fileId, { enabled: visible && !!fileId })

  useEffect(() => {
    if (visible || !ref.current || typeof IntersectionObserver === 'undefined') {
      if (!visible && typeof IntersectionObserver === 'undefined') setVisible(true)
      return undefined
    }
    const el = ref.current
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true)
        io.disconnect()
      }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  useEffect(() => setBroken(false), [fileId])

  const show = url && !broken
  return (
    <div ref={ref} className={cn('relative overflow-hidden', className)}>
      {!show && fallback}
      {url && !broken && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          onLoad={onLoad}
          className={cn('absolute inset-0 size-full object-cover', imgClassName)}
        />
      )}
    </div>
  )
}
