import type { Block, Inline } from '../../lib/markdown'
import { parseMarkdown } from '../../lib/markdown'

function Inlines({ nodes }: { nodes: Inline[] }): React.JSX.Element {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <span key={i}>{n.v}</span>
          case 'code':
            return (
              <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                {n.v}
              </code>
            )
          case 'bold':
            return (
              <strong key={i}>
                <Inlines nodes={n.c} />
              </strong>
            )
          case 'em':
            return (
              <em key={i}>
                <Inlines nodes={n.c} />
              </em>
            )
          case 'del':
            return (
              <del key={i}>
                <Inlines nodes={n.c} />
              </del>
            )
          case 'link':
            return (
              <a
                key={i}
                href={n.href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-foreground underline underline-offset-2"
              >
                <Inlines nodes={n.c} />
              </a>
            )
        }
      })}
    </>
  )
}

function BlockView({ b }: { b: Block }): React.JSX.Element {
  switch (b.t) {
    case 'h':
      return (
        <p className={b.level <= 2 ? 'text-base font-semibold' : 'font-semibold'}>
          <Inlines nodes={b.c} />
        </p>
      )
    case 'p':
      return (
        <p>
          <Inlines nodes={b.c} />
        </p>
      )
    case 'ul':
    case 'ol': {
      const List = b.t
      return (
        <List className={b.t === 'ul' ? 'list-disc pl-5' : 'list-decimal pl-5'}>
          {b.items.map((it, i) => (
            <li key={i}>
              <Inlines nodes={it} />
            </li>
          ))}
        </List>
      )
    }
    case 'quote':
      return (
        <blockquote className="border-l-2 pl-3 text-muted-foreground">
          <Inlines nodes={b.c} />
        </blockquote>
      )
    case 'pre':
      return <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">{b.v}</pre>
    case 'hr':
      return <hr className="border-border" />
  }
}

/** Renders project notes. Never uses innerHTML: markup in the source is shown as text. */
export function Markdown({ source }: { source: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 text-sm [overflow-wrap:anywhere]">
      {parseMarkdown(source).map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </div>
  )
}
