# ADR-0001: Local-first single-user web app

Status: Proposed
Date: 2026-10-10

## Context
One user, one Mac, personal data (tasks, project names). We want fast iteration, no accounts, no server to run, and privacy by default. We still need a browser for mic access and a rich dashboard UI.

## Decision
Build a TypeScript web app served locally (Vite + React, or Next.js in local mode) with a small local backend process that owns a SQLite file. No auth, no cloud database. The backend is the only holder of API keys (STT/LLM).

## Alternatives considered
- **Hosted SaaS (Postgres + auth):** adds accounts, hosting cost and privacy surface for no single-user benefit.
- **Native macOS app (SwiftUI):** best mic/global-hotkey story, but slower iteration and higher cost to change UI; revisit if push-to-talk in the browser proves limiting.
- **Pure browser (IndexedDB only):** simplest, but API keys would live in the client and there is no safe place for them.

## Consequences
- (+) Private, cheap, fast to build; trivial backup (copy the file) and JSON export.
- (+) Keys stay server-side.
- (−) No multi-device sync in v0; mobile access is out of scope.
- (−) Global hotkey requires a wrapper (Tauri/Electron) later.
