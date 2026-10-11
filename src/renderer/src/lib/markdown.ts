/**
 * Tiny, safe markdown parser for project notes. It produces a plain data tree that React renders
 * as elements, so raw HTML in the notes is shown as literal text and never injected.
 * Supported: #-###### headings, dash, star or plus bullets, 1. numbered lists, > quotes, fenced code, hr, paragraphs, and
 * inline **bold**, *italic*, `code`, ~~strike~~ and [text](http(s)/mailto link).
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold' | 'em' | 'del'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }

export type Block =
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'pre'; v: string }
  | { t: 'hr' }

const SAFE_LINK = /^(https?:\/\/|mailto:)[^\s]+$/i

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = (): void => {
    if (buf) out.push({ t: 'text', v: buf })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    let m: RegExpMatchArray | null
    if ((m = rest.match(/^`([^`]+)`/))) {
      flush()
      out.push({ t: 'code', v: m[1] })
    } else if ((m = rest.match(/^\*\*(.+?)\*\*/)) || (m = rest.match(/^__(.+?)__/))) {
      flush()
      out.push({ t: 'bold', c: parseInline(m[1]) })
    } else if ((m = rest.match(/^~~(.+?)~~/))) {
      flush()
      out.push({ t: 'del', c: parseInline(m[1]) })
    } else if (
      (m = rest.match(/^\*([^*\s][^*]*?)\*/)) ||
      (m = rest.match(/^_([^_\s][^_]*?)_(?!\w)/))
    ) {
      flush()
      out.push({ t: 'em', c: parseInline(m[1]) })
    } else if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/)) && SAFE_LINK.test(m[2])) {
      flush()
      out.push({ t: 'link', href: m[2], c: parseInline(m[1]) })
    } else {
      buf += src[i]
      i++
      continue
    }
    i += m[0].length
  }
  flush()
  return out
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  const flushPara = (): void => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m: RegExpMatchArray | null
    if (/^```/.test(line)) {
      flushPara()
      const code: string[] = []
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i])
      blocks.push({ t: 'pre', v: code.join('\n') })
    } else if (!line.trim()) {
      flushPara()
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara()
      blocks.push({ t: 'h', level: m[1].length, c: parseInline(m[2].trim()) })
    } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara()
      blocks.push({ t: 'hr' })
    } else if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      flushPara()
      const ordered = /^\s*\d+\./.test(line)
      const items: Inline[][] = []
      const re = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/
      for (; i < lines.length && (m = lines[i].match(re)); i++) items.push(parseInline(m[1]))
      i--
      blocks.push({ t: ordered ? 'ol' : 'ul', items })
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara()
      const q: string[] = [m[1]]
      while (i + 1 < lines.length && (m = lines[i + 1].match(/^>\s?(.*)$/))) {
        q.push(m[1])
        i++
      }
      blocks.push({ t: 'quote', c: parseInline(q.join(' ')) })
    } else {
      para.push(line.trim())
    }
  }
  flushPara()
  return blocks
}
