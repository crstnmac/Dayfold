import { ArrowRightToLine, CheckCheck, RotateCcw, Sunrise, Undo2, X } from 'lucide-react'
import type { AppState, Task } from '../../../shared/types'
import { toneClass, type Run } from '../dash'
import { WrapupHistory } from '@renderer/components/dash/wrapup-history'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Separator } from '@renderer/components/ui/separator'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@renderer/components/ui/empty'
import { friendlyDate } from '@renderer/lib/iso-date'

function Row({ t, children }: { t: Task; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-(--card-spacing) py-2.5">
      <div className="min-w-0 flex-1">
        <p className="[overflow-wrap:anywhere]">{t.title}</p>
        {t.project_name && <Badge variant="outline">{t.project_name}</Badge>}
      </div>
      {children}
    </div>
  )
}

function List({
  tasks,
  empty,
  render
}: {
  tasks: Task[]
  empty: string
  render: (t: Task) => React.ReactNode
}): React.JSX.Element {
  if (tasks.length === 0)
    return (
      <Empty className="border-0 py-8">
        <EmptyHeader>
          <EmptyTitle className="text-sm">{empty}</EmptyTitle>
          <EmptyDescription />
        </EmptyHeader>
      </Empty>
    )
  return (
    <>
      {tasks.map((t, i) => (
        <div key={t.id}>
          {i > 0 && <Separator />}
          {render(t)}
        </div>
      ))}
    </>
  )
}

export function WrapUpSection({ state, run }: { state: AppState; run: Run }): React.JSX.Element {
  const deadlines = state.projects.filter(
    (p) => p.status === 'active' && p.due && p.due <= state.tomorrow
  )

  return (
    <div className="flex flex-col gap-(--space-section)">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Done today</CardTitle>
            <CardAction>
              <Badge className={toneClass.good} variant="secondary">
                {state.doneToday.length}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col p-0">
            <List
              tasks={state.doneToday}
              empty="Nothing finished yet"
              render={(t) => (
                <Row t={t}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Reopen ${t.title}`}
                    onClick={() => run({ type: 'task.setStatus', taskId: t.id, status: 'todo' })}
                  >
                    <Undo2 />
                  </Button>
                </Row>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Carryover</CardTitle>
            <CardAction>
              <Badge className={toneClass.warn} variant="secondary">
                {state.carryover.length}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col p-0">
            <List
              tasks={state.carryover}
              empty="Plate is clear"
              render={(t) => (
                <Row t={t}>
                  {t.carry_count > 0 && (
                    <Badge className={toneClass.warn} variant="secondary">
                      {t.carry_count}×
                    </Badge>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Mark ${t.title} done`}
                    onClick={() => run({ type: 'task.setStatus', taskId: t.id, status: 'done' })}
                  >
                    <CheckCheck />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Drop ${t.title}`}
                    onClick={() => run({ type: 'task.setStatus', taskId: t.id, status: 'dropped' })}
                  >
                    <X />
                  </Button>
                </Row>
              )}
            />
            {state.carryover.length > 0 && (
              <>
                <Separator />
                <div className="px-(--card-spacing) py-3">
                  <Button
                    onClick={() =>
                      run({ type: 'day.carryOver', fromDate: state.today, toDate: state.tomorrow })
                    }
                  >
                    <ArrowRightToLine data-icon="inline-start" /> Carry all to tomorrow
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Follow-up tomorrow</CardTitle>
            <CardAction>
              <Badge variant="secondary">{state.tomorrowTasks.length}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col p-0">
            <List
              tasks={state.tomorrowTasks}
              empty="Nothing planned yet"
              render={(t) => (
                <Row t={t}>
                  {t.carry_count > 0 && (
                    <Badge className={toneClass.warn} variant="secondary">
                      carried {t.carry_count}×
                    </Badge>
                  )}
                  {t.due && (
                    <Badge variant="outline" className="tabular">
                      due {friendlyDate(t.due, state.today)}
                    </Badge>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move ${t.title} back to today`}
                    onClick={() => run({ type: 'task.plan', taskId: t.id, planDate: state.today })}
                  >
                    <RotateCcw />
                  </Button>
                </Row>
              )}
            />
            {deadlines.map((p) => (
              <div key={p.id}>
                <Separator />
                <div className="flex items-center gap-2 px-(--card-spacing) py-2.5">
                  <Sunrise className="size-4 text-muted-foreground" aria-hidden />
                  <p className="flex-1">Deadline: {p.name}</p>
                  <Badge className={toneClass.bad} variant="secondary">
                    {p.due}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {state.wrapups.length > 0 && (
        <WrapupHistory wrapups={state.wrapups} streak={state.wrapupStreak} />
      )}
    </div>
  )
}
