import { describe, expect, it } from 'vitest'
import { openDb } from '../src/main/db'
import { dispatch } from '../src/main/commands'
import { triage } from '../src/main/llm/triage'
import { interpret } from '../src/main/llm/interpret'
import { PROVIDERS } from '../src/main/llm/providers'

// Real CLI calls against your signed-in subscriptions. Run: DASH_LIVE_LLM=1 npx vitest run tests/llm.live
const live = process.env['DASH_LIVE_LLM'] ? describe : describe.skip

live.each(['claude', 'codex'] as const)(
  'live %s',
  (id) => {
    const p = PROVIDERS[id]
    it('reports a subscription login', async () => {
      const s = await p.status()
      expect(s).toMatchObject({ installed: true, loggedIn: true, authMethod: 'subscription' })
    })
    it('turns an utterance into valid commands', async () => {
      const db = openDb(':memory:')
      const meta = { source: 't', input: 'x' }
      dispatch(db, { type: 'project.create', name: 'Atlas launch' }, meta)
      dispatch(db, { type: 'task.add', title: 'Send invoice to Acme', projectId: 1 }, meta)
      const now = new Date(2026, 9, 10, 12)
      const r = await interpret(
        db,
        'I finished the Acme invoice, and push to friday the thing for Atlas: write press kit',
        p,
        '',
        { now }
      )
      console.log(id, JSON.stringify(r))
      expect(r.kind).toBe('commands')
    }, 120_000)
    it('suggests triage for dump items', async () => {
      const db = openDb(':memory:')
      const meta = { source: 't', input: 'x' }
      dispatch(db, { type: 'project.create', name: 'Atlas launch' }, meta)
      for (const t of [
        'email Sam the Atlas budget tomorrow',
        'asdf lkj',
        'maybe look into a standing desk'
      ])
        dispatch(db, { type: 'dump.add', text: t }, meta)
      const r = await triage(db, p, '', { now: new Date(2026, 9, 10, 12) })
      console.log(id, 'triage', JSON.stringify(r))
      expect(Array.isArray(r)).toBe(true)
    }, 180_000)
  },
  120_000
)
