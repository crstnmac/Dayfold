# PRD: Talk-to-It Weekly Dashboard

| | |
|---|---|
| Status | Draft v0.1 |
| Owner | Criston |
| Date | 2026-10-10 |
| Decisions | See [docs/adr/](adr/README.md) — this PRD states *what* and *why*; ADRs record *how* and the trade-offs |

## 1. Problem

Task managers fail personal weekly planning because **maintenance costs more than the plan is worth**. Typing, tagging, dragging and re-prioritising is a chore, so the system drifts out of date and stops being trusted. The user ends up planning in their head and the tool becomes a graveyard.

## 2. Vision

A personal work dashboard that runs the week. **You never type into it. You talk to it, and it updates itself.** The screen is a read-mostly view of your week; speech is the write path.

## 3. Assumptions (flag if wrong)

- Single user, single device to start (Mac browser). No collaboration.
- "A quick dump: a project and what's on my plate today at the end of the day" is read as the v0 slice: (a) dump a project by voice, (b) always see today's plate, (c) an end-of-day wrap-up that closes the day and seeds tomorrow.
- English only. Online connectivity is acceptable for transcription and the LLM.

## 4. Goals and non-goals

### Goals
1. Capture a project or task by speaking one sentence, in under 5 seconds from intent to saved.
2. Show "today's plate" at a glance, always accurate.
3. Close each day in under 2 minutes via a spoken end-of-day review.
4. Zero keyboard required for any core flow.
5. Never silently lose or corrupt data; every change is explainable and undoable.

### Non-goals (v0)
- Team features, sharing, assignment.
- Calendar/email/Slack integrations (future; see Roadmap).
- Native mobile app, always-on wake word.
- Habit tracking, time tracking, analytics.
- Replacing a full project-management tool.

## 5. Users and scenarios

**Primary user:** an individual juggling several projects who wants a trustworthy daily/weekly view with near-zero upkeep.

| # | Scenario | Utterance | Result |
|---|---|---|---|
| S1 | Dump a project | "New project: website relaunch, due end of November" | Project created with deadline |
| S2 | Add to the plate | "Today I need to send the invoice and review Sam's PR" | Two tasks on today's plate |
| S3 | Attach to project | "Add 'draft new homepage copy' to website relaunch for Thursday" | Task under project, scheduled Thursday |
| S4 | Update | "Invoice is done" / "Push the PR review to tomorrow" | Task completed / rescheduled |
| S5 | Query | "What's on my plate today?" | Plate read back and highlighted |
| S6 | End of day | "Wrap up my day" | Review: done, unfinished, proposed carry-over; user confirms by voice |
| S7 | Undo | "Undo that" | Last change reverted |

## 6. Functional requirements

IDs are priority-tagged: **P0** = v0 must-have, **P1** = next, **P2** = later.

### Voice input
- **FR-1 (P0)** Push-to-talk (hold a key or button) captures speech and shows the live transcript.
- **FR-2 (P0)** Transcript is converted to one or more structured *intents* (create/update/complete/reschedule/delete/query/review).
- **FR-3 (P0)** Ambiguous or low-confidence intents prompt a one-line spoken or on-screen clarification instead of guessing.

### Data model
- **FR-4 (P0)** Entities: Project (name, status, due date), Task (title, project?, scheduled date, status, notes), DayLog (date, summary, carried-over tasks).
- **FR-5 (P0)** Tasks without a project are valid (inbox).

### Dashboard
- **FR-6 (P0)** Today view: tasks scheduled today, grouped by project, with done/open state.
- **FR-7 (P0)** Projects view: list with open-task counts and due dates.
- **FR-8 (P1)** Week view: five/seven-day columns with load indicator.
- **FR-9 (P0)** Every voice change is shown as a visible diff ("Added 2 tasks to Today") for ~5s with an Undo control.

### End-of-day review
- **FR-10 (P0)** "Wrap up" lists completed tasks, unfinished tasks, and a proposed carry-over to tomorrow; user accepts, edits by voice, or rejects.
- **FR-11 (P0)** Accepting writes a DayLog entry and moves carry-over tasks.
- **FR-12 (P1)** Optional reminder at a user-set time to start the review.

### Trust and control
- **FR-13 (P0)** All mutations are recorded in an append-only event log; undo reverts the last event(s).
- **FR-14 (P0)** Destructive intents (delete project, bulk changes over a threshold) require explicit voice or click confirmation.
- **FR-15 (P0)** Data persists locally and survives restart; export to JSON.

### Voice output
- **FR-16 (P1)** Spoken confirmations and plate read-back (text-to-speech). v0 may be text-only.

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Latency | Speech end → UI updated: p50 < 2.5s, p95 < 5s |
| Accuracy | ≥ 95% of test utterances produce the correct mutation; the rest ask for clarification rather than writing wrong data |
| Safety | LLM output never writes to storage directly; it proposes validated, typed commands (ADR-0003) |
| Privacy | Data stays on the device; only transcript text (and audio if cloud STT) leaves it. No third-party analytics |
| Offline | Reading the dashboard and manual undo work offline; voice requires network in v0 |
| Accessibility | Full keyboard-optional operation; transcript visible for every utterance; WCAG AA contrast |
| Cost | Target under $5/month at ~100 utterances/day |

## 8. Success metrics

- **Activation:** user dumps first project + 3 tasks by voice in first session.
- **Habit:** ≥ 5 of 7 days with an end-of-day review completed, over 2 consecutive weeks.
- **Zero-typing:** ≥ 90% of mutations originate from voice.
- **Trust:** undo rate < 10% of mutations; wrong-write incidents < 1/week.
- **Speed:** median capture-to-saved < 5s.

## 9. Solution overview

```
 mic ──► STT ──► transcript ──► Intent Parser (LLM, tool-calling)
                                       │  typed Commands (proposed)
                                       ▼
                              Validator / Policy  ──► clarify? confirm?
                                       │ approved
                                       ▼
                         Command Handler ──► Event Log + SQLite state
                                       │
                                       ▼
                          Dashboard (Today / Projects / Week) + diff toast
```

Key design choices (full reasoning in ADRs):
- Local-first web app, single user ([ADR-0001](adr/0001-local-first-web-app.md))
- Voice is the only write path; UI is read-mostly ([ADR-0002](adr/0002-voice-first-read-mostly-ui.md))
- LLM proposes typed commands; deterministic code validates and applies ([ADR-0003](adr/0003-llm-proposes-commands-code-disposes.md))
- Event-sourced log with undo ([ADR-0004](adr/0004-event-log-and-undo.md))
- Speech-to-text approach ([ADR-0005](adr/0005-speech-to-text-strategy.md))

## 10. Milestones

| Milestone | Scope | Exit criterion |
|---|---|---|
| M0 Walking skeleton | Typed-transcript → command → SQLite → Today view (no mic yet) | Demo S1, S2, S5 from a text box used only as a dev harness |
| M1 Voice v0 | Push-to-talk STT, diff toast, undo, projects view | S1–S5, S7 pass by voice |
| M2 End of day | Wrap-up review, DayLog, carry-over | S6 works; 1 week of dogfooding |
| M3 Week | Week view, reminders, TTS read-back | P1 items complete |
| Later | Calendar read integration, mobile PWA, wake word | Revisit after dogfooding data |

## 11. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| LLM misparses and writes wrong data | Loss of trust | Typed commands + validation, visible diff, undo, clarify on low confidence (FR-3, 9, 13) |
| STT mishears names/jargon | Wrong tasks | Show transcript, personal vocabulary hints from project names, easy re-speak |
| Voice is awkward in open spaces | Low usage | Keep a text-box fallback in the dev harness; revisit if it matters in dogfooding |
| Latency feels slow | Abandonment | Stream STT, small fast model for parsing, optimistic UI |
| Scope creep into a full PM tool | Never ships | Non-goals list; ADR required to add entities |

## 12. Open questions

1. Is the "quick dump" (project + today's plate at end of day) the right v0 scope, or did you mean something broader, like a daily brain-dump that Claude sorts into projects?
2. Mac-only browser tab, or menu-bar/desktop wrapper for global push-to-talk?
3. Is cloud STT acceptable, or must audio stay on-device?
4. Week starts Monday or Sunday? Working hours for the plate load indicator?
5. Which integrations matter first: calendar, email, Slack?
