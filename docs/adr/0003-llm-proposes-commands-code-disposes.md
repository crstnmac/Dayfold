# ADR-0003: LLM proposes typed commands; code validates and applies

Status: Proposed
Date: 2026-10-10

## Context
Natural language must become data changes. LLMs are good at interpreting messy speech ("push that PR thing to tomorrow") but can hallucinate IDs, dates and fields. Writing their output straight into storage would make wrong-write incidents likely.

## Decision
The LLM is used only as an intent parser via tool calling. Each tool is a typed command (`create_project`, `add_task`, `complete_task`, `reschedule_task`, `delete_*`, `query_plate`, `start_review`, …) with a strict schema. The model receives a compact snapshot of current state (open tasks with short IDs, projects, today's date and timezone) so it references real entities. Deterministic code then:
1. validates schema and referential integrity,
2. resolves relative dates in the user's timezone,
3. applies policy (confirmation for destructive or bulk commands; clarification on low confidence or multiple matches),
4. executes and emits events (ADR-0004).

Default model: a small, fast Claude model for parsing; escalate to a larger model only for the end-of-day review summary.

## Alternatives considered
- **Rule/regex/grammar parser:** deterministic and free, but brittle on natural speech; rejected as primary, may be used as a fast path for trivial phrases.
- **LLM writes SQL or free-form JSON patches:** flexible, but unsafe and hard to test.
- **Agentic loop with free tool use:** more capable, but higher latency and cost than needed for single-step intents.

## Consequences
- (+) Wrong or malicious model output cannot corrupt data beyond what a valid command allows.
- (+) Commands are unit-testable; a fixture set of utterance → command pairs becomes our eval suite.
- (−) Adding a capability means defining a new command schema (intentional friction).
- (−) Requires sending a state snapshot per request; keep it small to control cost and latency.
- Note: transcript text and a minimal state snapshot are sent to the LLM provider (see PRD privacy NFR).
