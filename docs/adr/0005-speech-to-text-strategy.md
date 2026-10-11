# ADR-0005: Speech-to-text strategy

Status: Proposed
Date: 2026-10-10

## Context
Accuracy on personal names, project names and dates is the biggest driver of perceived quality. We need push-to-talk in a browser, low latency, and a path to better privacy later. Open question: whether cloud audio is acceptable (PRD Q3).

## Decision
Start behind a `Transcriber` interface with a cloud STT provider (streaming, supports custom vocabulary hints) as the v0 default, using push-to-talk. Feed project names and recent task titles as vocabulary hints. Always show the transcript and allow re-speak. Keep the browser Web Speech API as a zero-setup dev fallback only.

Revisit and consider on-device Whisper (whisper.cpp) if (a) the user requires audio to stay local or (b) cloud cost/latency is unsatisfactory.

## Alternatives considered
- **Web Speech API only:** free and instant to set up, but inconsistent across browsers, no vocabulary control, and audio goes to the browser vendor.
- **On-device Whisper from day one:** best privacy, but extra setup, higher latency on long utterances, and slower iteration for v0.
- **Always-on wake word:** better ergonomics, but privacy and false-trigger cost; out of scope for v0.

## Consequences
- (+) Fast path to a working voice loop; swapping providers is one adapter.
- (−) Audio leaves the device in v0; must be disclosed in the UI and docs.
- (−) Vocabulary-hint support varies by provider; may influence provider choice.
