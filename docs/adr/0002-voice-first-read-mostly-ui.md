# ADR-0002: Voice is the only write path; UI is read-mostly

Status: Proposed
Date: 2026-10-10

## Context
The core product promise is "don't type into it, talk to it." If forms and drag-and-drop exist, they become the path of least resistance and voice becomes decorative. Conversely, a pure-voice system with no controls is frustrating when speech fails.

## Decision
All creation and editing flows go through voice commands. The UI is for *viewing* plus a small set of safety controls: Undo, Confirm/Cancel on prompts, toggle task done, and re-speak. During development, a text input exists as a harness that feeds the same transcript → command pipeline (not a separate write path).

## Alternatives considered
- **Hybrid full CRUD UI + voice:** familiar, but erodes the zero-typing goal and doubles the surface to build and keep consistent.
- **Voice only, no controls:** purist, but a failed mic or misheard word leaves the user stuck.

## Consequences
- (+) One write pipeline to build, test and audit.
- (+) Product stays true to its promise; metric "≥ 90% mutations via voice" is meaningful.
- (−) Voice errors must be handled gracefully (clarify, undo); this is the main UX risk.
- (−) Users in noisy/shared spaces are underserved; revisit with dogfooding data.
