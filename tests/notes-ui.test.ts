import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from '../src/renderer/src/lib/markdown'
import { projectHealth } from '../src/renderer/src/lib/health'
import type { Project } from '../src/shared/types'

describe('safe markdown', () => {
  it('keeps raw HTML as literal text', () => {
    const inl = parseInline('<img src=x onerror=alert(1)> and <b>hi</b>')
    expect(inl.every((n) => n.t === 'text')).toBe(true)
    expect(inl.map((n) => (n.t === 'text' ? n.v : '')).join('')).toContain('<img src=x')
  })
  it('only links http(s) and mailto', () => {
    expect(parseInline('[a](javascript:alert(1))').some((n) => n.t === 'link')).toBe(false)
    expect(parseInline('[a](data:text/html,x)').some((n) => n.t === 'link')).toBe(false)
    expect(parseInline('[a](https://x.com/p)')[0]).toMatchObject({
      t: 'link',
      href: 'https://x.com/p'
    })
    expect(parseInline('[m](mailto:a@b.co)')[0]).toMatchObject({ t: 'link' })
  })
  it('parses headings, lists, quotes, code and emphasis', () => {
    const b = parseMarkdown(
      '# T\n\n- a\n- **b** and *c* `d`\n\n1. x\n2. y\n\n> q\n\n```\n<script>\n```\npara\nmore'
    )
    expect(b.map((x) => x.t)).toEqual(['h', 'ul', 'ol', 'quote', 'pre', 'p'])
    expect(b[1]).toMatchObject({ t: 'ul' })
    expect(b[4]).toMatchObject({ t: 'pre', v: '<script>' })
    expect(b[5]).toMatchObject({ t: 'p' })
  })
  it('handles unbalanced markers and empty input', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseInline('**oops and `tick')).toEqual([{ t: 'text', v: '**oops and `tick' }])
  })
})

describe('project health (FR-14)', () => {
  const day = 86400000
  const now = Date.now()
  const p = (o: Partial<Project>): Project => ({
    id: 1,
    name: 'A',
    goal: '',
    status: 'active',
    due: null,
    next_action: '',
    notes: '',
    created_at: 0,
    touched_at: now,
    open_tasks: 2,
    ...o
  })
  it('is healthy when active, touched recently and has open tasks', () => {
    expect(projectHealth(p({}), now)).toBeNull()
  })
  it('warns with no open tasks, and when untouched 7+ days', () => {
    expect(projectHealth(p({ open_tasks: 0 }), now)).toMatch(/No open/)
    expect(projectHealth(p({ touched_at: now - 8 * day }), now)).toMatch(/8 days/)
    expect(projectHealth(p({ touched_at: now - 6 * day }), now)).toBeNull()
  })
  it('ignores paused and done projects', () => {
    expect(projectHealth(p({ status: 'paused', open_tasks: 0 }), now)).toBeNull()
    expect(projectHealth(p({ status: 'done', touched_at: 0 }), now)).toBeNull()
  })
})
