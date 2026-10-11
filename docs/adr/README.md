# Architecture Decision Records

We record each significant decision in a short, immutable file using the format below. To change a decision, write a new ADR that supersedes the old one; never edit history.

## Principles
1. **One decision per record.** Small, focused, numbered (`NNNN-slug.md`).
2. **Context before choice.** State the forces and constraints first.
3. **Name the alternatives.** Record what we rejected and why.
4. **State consequences honestly**, including the downsides we accept.
5. **Immutable once accepted.** Supersede, don't rewrite.
6. **Decide at the last responsible moment**, but do decide.

## Template
```
# ADR-NNNN: Title
Status: Proposed | Accepted | Superseded by ADR-XXXX
Date: YYYY-MM-DD
## Context
## Decision
## Alternatives considered
## Consequences
```

## Index
| ADR | Title | Status |
|---|---|---|
| [0001](0001-local-first-web-app.md) | Local-first single-user web app | Proposed |
| [0002](0002-voice-first-read-mostly-ui.md) | Voice is the only write path; UI is read-mostly | Proposed |
| [0003](0003-llm-proposes-commands-code-disposes.md) | LLM proposes typed commands; code validates and applies | Proposed |
| [0004](0004-event-log-and-undo.md) | Append-only event log with undo | Proposed |
| [0005](0005-speech-to-text-strategy.md) | Speech-to-text strategy | Proposed |
