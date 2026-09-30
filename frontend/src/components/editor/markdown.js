/**
 * Small HTML <-> Markdown helpers for written documents and text uploads.
 * Not a full spec implementation; covers what the editor produces.
 */

function escapeMd(text = '') {
  return String(text).replace(/([\\`*_{}[\]#+!|])/g, '\\$1')
}

function inline(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeMd(node.textContent)
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const tag = node.tagName.toLowerCase()
  const kids = () => Array.from(node.childNodes).map(inline).join('')
  switch (tag) {
    case 'strong':
    case 'b':
      return `**${kids()}**`
    case 'em':
    case 'i':
      return `*${kids()}*`
    case 'u':
      return `<u>${kids()}</u>`
    case 's':
    case 'del':
    case 'strike':
      return `~~${kids()}~~`
    case 'code':
      return `\`${node.textContent}\``
    case 'a': {
      const href = node.getAttribute('href') || ''
      return href ? `[${kids()}](${href})` : kids()
    }
    case 'br':
      return '  \n'
    case 'img': {
      const src = node.getAttribute('src') || ''
      return src.startsWith('data:') ? `![${node.getAttribute('alt') || 'image'}](embedded image)` : `![${node.getAttribute('alt') || ''}](${src})`
    }
    default:
      return kids()
  }
}

function block(node, indent = '') {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent.trim()
    return t ? `${indent}${escapeMd(t)}\n\n` : ''
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const tag = node.tagName.toLowerCase()
  const children = Array.from(node.childNodes)
  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return `${'#'.repeat(Number(tag[1]))} ${children.map(inline).join('').trim()}\n\n`
    case 'p': {
      const t = children.map(inline).join('').trim()
      return t ? `${indent}${t}\n\n` : ''
    }
    case 'blockquote':
      return children.map((c) => block(c)).join('').split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n') + '\n\n'
    case 'pre':
      return `\`\`\`\n${node.textContent.replace(/\n$/, '')}\n\`\`\`\n\n`
    case 'hr':
      return '---\n\n'
    case 'ul':
    case 'ol': {
      const isTask = node.getAttribute('data-type') === 'taskList'
      let i = 0
      return (
        Array.from(node.children)
          .filter((li) => li.tagName.toLowerCase() === 'li')
          .map((li) => {
            i += 1
            const checked = li.getAttribute('data-checked') === 'true'
            const marker = tag === 'ol' ? `${i}. ` : isTask ? `- [${checked ? 'x' : ' '}] ` : '- '
            const inlineParts = []
            const nested = []
            Array.from(li.childNodes).forEach((c) => {
              const ct = c.nodeType === Node.ELEMENT_NODE ? c.tagName.toLowerCase() : ''
              if (ct === 'ul' || ct === 'ol') nested.push(c)
              else if (ct === 'label') return
              else if (ct === 'div' || ct === 'p') inlineParts.push(Array.from(c.childNodes).map(inline).join(''))
              else inlineParts.push(inline(c))
            })
            const text = inlineParts.join(' ').replace(/\s+/g, ' ').trim()
            const sub = nested.map((n) => block(n, `${indent}  `)).join('')
            return `${indent}${marker}${text}\n${sub ? sub.replace(/\n\n$/, '\n') : ''}`
          })
          .join('') + (indent ? '' : '\n')
      )
    }
    case 'table': {
      const rows = Array.from(node.querySelectorAll('tr'))
      if (!rows.length) return ''
      const cells = (tr) => Array.from(tr.children).map((td) => Array.from(td.childNodes).map(inline).join('').replace(/\n/g, ' ').trim() || ' ')
      const head = cells(rows[0])
      const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`]
      rows.slice(1).forEach((tr) => lines.push(`| ${cells(tr).join(' | ')} |`))
      return lines.join('\n') + '\n\n'
    }
    case 'img':
      return `${inline(node)}\n\n`
    default:
      return children.map((c) => block(c, indent)).join('')
  }
}

/** HTML -> Markdown string. */
export function htmlToMarkdown(html = '') {
  const div = document.createElement('div')
  div.innerHTML = String(html || '')
  return block(div).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

function escapeHtml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inlineMd(text = '') {
  let s = escapeHtml(text)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  s = s.replace(/_([^_]+)_/g, '<em>$1</em>')
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  s = s.replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img src="$2" alt="$1">')
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
  return s
}

/**
 * Markdown -> simple HTML (headings, paragraphs, lists, checklists, quotes, code, rules, tables).
 * Good enough to open a .md file in the editor.
 */
export function markdownToHtml(md = '') {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let para = []
  let list = null // { type: 'ul'|'ol'|'task', items: [] }
  let code = null
  let table = null

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inlineMd).join('<br>')}</p>`)
    para = []
  }
  const flushList = () => {
    if (!list) return
    if (list.type === 'task') {
      out.push(`<ul data-type="taskList">${list.items.map((i) => `<li data-type="taskItem" data-checked="${i.checked}"><p>${inlineMd(i.text)}</p></li>`).join('')}</ul>`)
    } else {
      out.push(`<${list.type}>${list.items.map((i) => `<li><p>${inlineMd(i.text)}</p></li>`).join('')}</${list.type}>`)
    }
    list = null
  }
  const flushTable = () => {
    if (!table) return
    const row = (cells, tag) => `<tr>${cells.map((c) => `<${tag}><p>${inlineMd(c)}</p></${tag}>`).join('')}</tr>`
    out.push(`<table><tbody>${row(table.head, 'th')}${table.rows.map((r) => row(r, 'td')).join('')}</tbody></table>`)
    table = null
  }
  const flushAll = () => {
    flushPara()
    flushList()
    flushTable()
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (code !== null) {
      if (/^```/.test(line)) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
        code = null
      } else code.push(raw)
      continue
    }
    if (/^```/.test(line)) {
      flushAll()
      code = []
      continue
    }
    if (!line.trim()) {
      flushAll()
      continue
    }
    let m
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushAll()
      out.push(`<h${m[1].length}>${inlineMd(m[2])}</h${m[1].length}>`)
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushAll()
      out.push('<hr>')
      continue
    }
    if ((m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/))) {
      flushPara()
      flushTable()
      if (!list || list.type !== 'task') {
        flushList()
        list = { type: 'task', items: [] }
      }
      list.items.push({ checked: m[1].toLowerCase() === 'x', text: m[2] })
      continue
    }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      flushPara()
      flushTable()
      if (!list || list.type !== 'ul') {
        flushList()
        list = { type: 'ul', items: [] }
      }
      list.items.push({ text: m[1] })
      continue
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara()
      flushTable()
      if (!list || list.type !== 'ol') {
        flushList()
        list = { type: 'ol', items: [] }
      }
      list.items.push({ text: m[1] })
      continue
    }
    if ((m = line.match(/^>\s?(.*)$/))) {
      flushAll()
      out.push(`<blockquote><p>${inlineMd(m[1])}</p></blockquote>`)
      continue
    }
    if (/^\|.*\|$/.test(line.trim())) {
      flushPara()
      flushList()
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim())
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue // separator row
      if (!table) table = { head: cells, rows: [] }
      else table.rows.push(cells)
      continue
    }
    flushList()
    flushTable()
    para.push(line)
  }
  if (code !== null) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
  flushAll()
  return out.join('\n')
}

/** Plain text -> paragraphs. */
export function textToHtml(text = '') {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n') || '<p></p>'
}
