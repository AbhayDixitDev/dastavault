/**
 * Server-side HTML sanitiser for notes and written documents. The browser
 * already runs DOMPurify; this is the second line of defence and is
 * intentionally simple (regex based, no DOM): it removes script-bearing
 * elements, inline event handlers and javascript:/data: URLs.
 */
const DANGEROUS_TAGS = ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'base', 'form', 'frame', 'frameset', 'applet']

export function sanitizeHtml(input) {
  if (typeof input !== 'string' || !input) return ''
  let html = input
  // Elements with content: <script>...</script>, <style>...</style>, ...
  for (const tag of DANGEROUS_TAGS) {
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '')
    html = html.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '')
  }
  // Comments and CDATA
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
  // on*="..." / on*='...' / on*=bare
  html = html.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  // javascript:, vbscript:, data: (except images) in href/src/action/xlink:href
  html = html.replace(/\s+(href|src|action|formaction|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, attr, _q, dq, sq, bare) => {
    const value = (dq ?? sq ?? bare ?? '').trim()
    const scheme = value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase()
    if (/^(javascript|vbscript|livescript):/.test(scheme)) return ''
    if (/^data:/.test(scheme) && !/^data:image\//.test(scheme)) return ''
    return m
  })
  // srcdoc and style expressions
  html = html.replace(/\s+srcdoc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  html = html.replace(/expression\s*\(/gi, '')
  return html
}

/** Plain text from HTML (fallback when a client sends no content_text). */
export function htmlToText(html) {
  if (typeof html !== 'string') return ''
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}
