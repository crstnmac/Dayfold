# ADR-0004: Append-only event log with undo

Status: Proposed
Date: 2026-10-10

## Context
Voice input is error-prone, so users must be able to see what changed and reverse it cheaply. We also want an audit trail to debug misparses and to build an eval set from real use.

## Decision
Every applied command emits one or more immutable events (`TaskAdded`, `TaskCompleted`, `TaskRescheduled`, `ProjectCreated`, `DayClosed`, …) stored in an append-only SQLite table with the originating transcript, parsed command, timestamp and a `batch_id`. Current state tables are projections of the log (kept transactionally in sync). Undo appends compensating events for the latest batch rather than deleting history. Deletes are soft.

## Alternatives considered
- **CRUD with a snapshot-based undo stack:** simpler, but loses history and cannot explain "why did this change?"
- **Full event sourcing with rebuild-from-log as the only truth:** purist, more complexity than a single-user app needs; we keep projections as the read model and use the log for audit/undo.

## Consequences
- (+) Reliable undo, a visible change diff for free (events → toast), and replayable bug reports.
- (+) Real utterances + outcomes become labelled test data.
- (−) Slightly more code than plain CRUD; projection and log must stay consistent (single transaction).
- (−) Transcripts are stored locally; provide a "purge history" control and exclude from exports unless requested.
