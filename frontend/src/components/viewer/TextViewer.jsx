import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'

/**
 * Readable card for written or text documents. `html` is sanitised before
 * rendering; `text` is shown as plain paragraphs when there is no HTML.
 */
export function TextViewer({ html, text, className }) {
  const clean = useMemo(() => {
    if (!html) return ''
    try {
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'], FORBID_ATTR: ['onerror', 'onload', 'style'] })
    } catch {
      return ''
    }
  }, [html])

  return (
    <div className={cn('scroll-inside size-full bg-muted/40 p-3 sm:p-6', className)}>
      <article className="prose-dv mx-auto max-w-3xl rounded-2xl border bg-card p-5 shadow-soft sm:p-8">
        {clean ? (
          <div className="text-[15px] leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-lg [&_h3]:font-semibold [&_img]:max-w-full [&_img]:rounded-lg [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-muted [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-6" dangerouslySetInnerHTML={{ __html: clean }} />
        ) : text ? (
          <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{text}</div>
        ) : (
          <p className="text-sm text-muted-foreground">There is no text to show yet.</p>
        )}
      </article>
    </div>
  )
}
