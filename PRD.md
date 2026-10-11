# PRD: Personal Productivity Dashboard ("Dash")

| | |
|---|---|
| Status | v0.2: Phase 0-1 implemented, see §14 |
| Date | 2026-10-10 |
| Owner | Criston |
| Platform | macOS desktop (Electron) |
| Decision records | ADR format, inline in §10 |

---

## 1. Summary

Dash is a single-user desktop dashboard that runs my week. I talk to it (or type), and it updates itself. It answers four questions at a glance:

1. **Quick dump**: what's in my head right now?
2. **Projects**: what am I building, and what state is each in?
3. **My plate**: what do I have to do today and this week?
4. **Tomorrow**: at day's end, what is carried over and what's planned next?

**v1 uses no LLM.** Voice becomes text, and a deterministic command parser turns text into updates. An **OpenAI-compatible provider layer** is designed in from day one (ADR-006) so any OpenAI-style endpoint can be plugged in later. It ships disabled in v1 and is switched on in Phase 2.

## 2. Problem and goals

**Problem.** Task and notes apps demand structure at capture time (pick a list, set a date, tag it). That friction means thoughts never get captured, and the week drifts.

**Goals**
- G1. Capture a thought in under 3 seconds, by voice or hotkey, with no categorisation required.
- G2. Show the whole week (dump, projects, plate, tomorrow) on one screen with no navigation.
- G3. Update the dashboard by speaking natural, short commands ("add to Atlas: fix login bug", "done with invoice").
- G4. Run an end-of-day ritual that produces tomorrow's list in under 2 minutes.
- G5. Work fully offline and keep all data local in v1.
- G6. Make adding an LLM later a configuration change, not a rewrite.

**Non-goals (v1)**
- No LLM calls of any kind, and no network access except update checks (off by default).
- No multi-user, sync, accounts, or mobile.
- No calendar, email, or GitHub integrations (candidates for Phase 3).
- Not a replacement for a full project-management tool (no Gantt, dependencies, time tracking).

## 3. User and context

One user: me. Mac, heavy voice-dictation user (Wispr Flow), several concurrent projects, works in bursts. Wispr Flow already types dictated text into any focused field system-wide, so **Dash's input box must be an excellent dictation target**, and Dash also offers its own built-in voice input (ADR-004) for when Wispr isn't running.

## 4. Core concepts (domain model)

| Term | Definition |
|---|---|
| **Dump item** | Raw captured text with a timestamp. Unprocessed by default. Can be *triaged* into a task, a project note, or discarded. |
| **Project** | A named effort with a status (`active`, `paused`, `done`), a one-line goal, an optional next action, and notes. |
| **Task** | A unit of work. Belongs to zero or one project. Has `status` (`todo`, `doing`, `done`), optional `due` date, and `plan_date` (the day I intend to do it). |
| **Plate** | Derived view: tasks where `plan_date` ≤ today and status ≠ done, plus tasks due this week. |
| **Day plan** | The set of tasks with `plan_date` = a given day. "Tomorrow" is the day plan for today+1. |
| **Wrap-up** | The end-of-day ritual: review the plate, resolve each open item (done / carry / drop / defer), review the dump, confirm tomorrow. |
| **Command** | A parsed voice/text utterance that mutates the above. |

## 5. Functional requirements

### 5.1 Dashboard layout (single window)

Four panels, always visible on one screen, with a command bar docked at the bottom.

| Panel | Contents |
|---|---|
| **Quick dump** | Reverse-chronological list of untriaged dump items. One-click triage actions. Count badge. |
| **Projects** | Cards: name, status, goal, next action, open-task count, last touched. Click to expand tasks and notes. |
| **My plate** | Today's tasks grouped by project, with overdue items flagged. Check to complete. |
| **Tomorrow** | Tomorrow's day plan. Becomes the primary panel after the wrap-up time (default 17:30). |

A week strip (Mon–Sun) at the top shows task counts per day; selecting a day swaps the Plate panel to that day.

### 5.2 Capture and input

- **FR-1** Global hotkey (default `⌥Space`) opens a small capture bar from anywhere and focuses the text field. Enter saves to the dump, and Esc dismisses.
- **FR-2** The command bar accepts typed or dictated text (works with Wispr Flow because it is a plain focused text field).
- **FR-3** Built-in voice input: a mic button and push-to-talk hotkey that streams partial transcripts into the command bar, using on-device Apple speech recognition (ADR-004). The user reviews the transcript, then Enter submits. Optional "auto-submit on silence" setting.
- **FR-4** Anything the parser can't interpret defaults to **quick dump**. Nothing is ever lost or rejected.

### 5.3 Voice/text commands (deterministic grammar, v1)

Commands are matched by an ordered rule set (ADR-005). Examples:

| Utterance | Effect |
|---|---|
| "dump: call the plumber" / bare text | Create dump item |
| "add task write the PRD to Atlas" / "task: … in Atlas" | Create task in project |
| "new project Atlas, goal ship the beta" | Create project |
| "done with invoice" / "finish write the PRD" | Fuzzy-match open task → done |
| "move X to tomorrow" / "push X to Friday" | Set `plan_date` |
| "due Friday: send report" | Task with due date |
| "start X" | Status → doing |
| "pause Atlas" / "mark Atlas done" | Project status |
| "note on Atlas: decided to use SQLite" | Append project note |
| "what's on my plate" / "show tomorrow" | Focus the relevant panel |
| "wrap up" / "plan tomorrow" | Start wrap-up flow |
| "undo" | Revert last command |

Requirements:
- **FR-5** Date phrases supported: today, tomorrow, weekday names, "next week", "in N days", explicit dates.
- **FR-6** Fuzzy matching on task/project names. If confidence is below the threshold or two candidates tie, show a disambiguation chooser (keyboard 1–9), never guess silently.
- **FR-7** Every command shows an inline confirmation toast with **Undo** (also `⌘Z`). The undo stack is persisted for the day.
- **FR-8** Unmatched input is saved to the dump and the toast says so.

### 5.4 End-of-day wrap-up

- **FR-9** Triggered by command, button, or a gentle notification at the configured time.
- **FR-10** Step 1: walk each open task on today's plate, resolving it as **done / carry to tomorrow / defer to date / drop** (keyboard-driven, voice-friendly). Step 2: triage remaining dump items into tasks, notes, or discard. Step 3: show proposed tomorrow list (carried tasks + due tomorrow + per-project next actions). The user reorders, adds, or removes. Step 4: confirm, which locks tomorrow's plan and clears the day.
- **FR-11** A wrap-up summary is stored: counts completed, carried, dropped, plus a free-text "one thing I want to remember". Browsable in a History view.
- **FR-12** Carry-over count is tracked per task. After 3 carries, flag it ("stale") and prompt: break down, defer, or drop.

### 5.5 Projects

- **FR-13** CRUD for projects with status, goal, next action, notes (markdown).
- **FR-14** The project card surfaces *next action* and warns when an active project has no open tasks or hasn't been touched in 7 days.

### 5.6 Settings

- Hotkeys, wrap-up time, week start day, speech language, auto-submit-on-silence, data folder location, export.
- **LLM Providers** (disabled in v1, see §7).

## 6. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | Cold start to interactive < 2 s on Apple Silicon. Command latency < 100 ms excluding speech. |
| NFR-2 | All data local. Single SQLite file in `~/Library/Application Support/Dash`. No telemetry. |
| NFR-3 | Export everything to JSON and Markdown at any time. Daily automatic backup, 14 retained. |
| NFR-4 | Electron security baseline: `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer, strict CSP, typed IPC allow-list. |
| NFR-5 | Full keyboard operability. Respects system light/dark mode and reduced motion. |
| NFR-6 | Secrets (future API keys) stored in macOS Keychain via `safeStorage`, never in the DB or plaintext config. |
| NFR-7 | Speech and mic permission denial degrades gracefully to typed input with a clear message. |

## 7. LLM provider layer (designed now, enabled in Phase 2)

Requirement: support **any OpenAI-compatible endpoint** (OpenAI, OpenRouter, Together, Groq, Ollama, LM Studio, vLLM, Azure OpenAI via base URL, etc.).

- **FR-L1** Provider config: `name`, `baseUrl`, `apiKey` (Keychain), `defaultModel`, optional custom headers, optional per-provider timeout. Multiple providers can be saved, and one is marked active.
- **FR-L2** Calls go through a single `LLMClient` interface using the `/v1/chat/completions` contract (streaming + tool/function calling where available), and `/v1/models` for model discovery. The main process owns all network calls, so keys never reach the renderer.
- **FR-L3** "Test connection" button (lists models, sends a trivial ping).
- **FR-L4** v1 ships the interface, the settings UI **hidden behind a feature flag**, and the config schema. No code path in v1 invokes it.
- **FR-L5 (Phase 2 use cases)**: (a) a fallback when the rule parser has low confidence, mapping utterance to the same typed `Command` objects, so the LLM never writes to the DB directly; (b) dump auto-triage suggestions; (c) wrap-up summary and tomorrow suggestions. All LLM output is validated against the command schema and subject to the same Undo.
- **FR-L6** Privacy: a clear per-provider notice of what data is sent. Local endpoints (Ollama/LM Studio) are the recommended default.

## 8. Architecture overview

```
┌────────────── Renderer (React + TS, sandboxed) ──────────────┐
│ Dashboard panels · Command bar · Wrap-up flow · Settings      │
└───────────────▲──────────── typed IPC (preload) ─────────────┘
┌───────────────┴────────────── Main process ──────────────────┐
│ Command pipeline: text → Parser → Command → Handler → DB     │
│ Store (SQLite) · Scheduler (wrap-up) · Global shortcuts       │
│ Speech bridge ──► native helper (Swift, SFSpeechRecognizer)   │
│ LLMClient (OpenAI-compatible) ── disabled in v1               │
└───────────────────────────────────────────────────────────────┘
```

Key seam: **`Command` is the only way state changes.** Voice, typed text, UI clicks, and (later) LLM output all produce `Command` objects handled by one reducer. This gives Undo, an audit log, and a safe LLM integration for free.

**Suggested stack:** Electron + Vite + React + TypeScript, Tailwind (+ shadcn/ui), Zustand for UI state, `better-sqlite3` + Drizzle (or Kysely), `chrono-node` for dates, `fuse.js` for fuzzy match, Vitest + Playwright (Electron) for tests, electron-builder or Forge for packaging.

## 9. Phased delivery

| Phase | Scope | Exit criteria |
|---|---|---|
| **0: Foundation** | Scaffold from template, security baseline, SQLite schema + migrations, `Command` pipeline with undo, CI | App launches, one command round-trips through IPC → DB → UI |
| **1: Core dashboard (MVP)** | Four panels, dump, projects, tasks, command bar, grammar v1, global capture hotkey | I can run a full day in it using Wispr Flow dictation |
| **2: Wrap-up + built-in voice** | Wrap-up flow, tomorrow plan, week strip, native speech bridge, push-to-talk, history | Wrap-up < 2 min, 2 weeks of daily use without data loss |
| **3: LLM providers** | Enable provider settings, LLMClient, parser fallback, dump triage, summaries | Works against OpenAI and a local Ollama model with zero code changes |
| **4: Integrations** | Calendar, GitHub issues, menu-bar widget | TBD |

## 10. Architecture Decision Records

Each ADR: **Status · Context · Decision · Consequences · Alternatives**.

### ADR-001: Electron as the desktop shell
- **Status:** Accepted (requested by owner)
- **Context:** Want a proper desktop app with a rich dashboard UI, global shortcuts, tray/notifications, and fast iteration in web tech.
- **Decision:** Electron.
- **Consequences:** + Mature ecosystem, global shortcuts/notifications/safeStorage built in, easy UI iteration. − Larger memory/disk footprint, native speech needs a bridge (ADR-004), security hardening is our responsibility (NFR-4).
- **Alternatives:** Tauri (smaller, but Rust toolchain and weaker webview consistency); native SwiftUI (best speech and OS integration, but slower UI iteration and not the requested stack).

### ADR-002: Start from an `electron-vite` + React + TypeScript template
- **Status:** Proposed (verify upstream repo health before cloning)
- **Context:** Searched GitHub. Candidates:
  - [electron-vite/electron-vite-react](https://github.com/electron-vite/electron-vite-react): Vite-based, fast HMR, lean. Packaging is not its focus, so add electron-builder.
  - [electron-react-boilerplate](https://github.com/electron-react-boilerplate/electron-react-boilerplate): batteries-included, established, electron-builder packaging, but webpack and a heavier structure.
  - [Electron Forge](https://www.electronforge.io/) (official toolchain, with a Vite + TypeScript template): best packaging and publishing story, less of a UI starter.
- **Decision:** Scaffold with `electron-vite` (React + TS). Add electron-builder for the DMG. Do **not** carry over any template default that enables Node integration in the renderer, since we override it per NFR-4.
- **Consequences:** + Fast dev loop, modern tooling. − We own packaging and signing setup. Community templates can go stale, so pin versions and prune unused features after scaffolding.
- **Alternatives:** Forge-Vite template if packaging/notarisation friction turns out higher than expected. This is a cheap switch in Phase 0.

### ADR-003: Local SQLite as the single source of truth
- **Status:** Accepted
- **Context:** Single user, offline, relational data (projects ↔ tasks), need undo/audit and export.
- **Decision:** One SQLite file via `better-sqlite3`, with versioned migrations and an append-only `command_log` table.
- **Consequences:** + Fast, transactional, trivially backed up. − Native module must be rebuilt per Electron version (handled by the build tooling). No sync (a non-goal).
- **Alternatives:** JSON/Markdown files (human-readable but weak for queries and undo); IndexedDB (trapped in the renderer); Postgres/cloud (overkill, violates local-first).

### ADR-004: Voice input via Wispr Flow only
- **Status:** Superseded by ADR-009 (no built-in speech; Wispr Flow dictates into the command bar)
- **Original decision (kept for history):** Wispr Flow + native on-device Apple speech bridge. Spike required in Phase 2
- **Context:** The owner already dictates with Wispr Flow, which types into any focused field. Electron's Web Speech API is unreliable because Chromium's speech backend is not available in Electron builds. Apple's `SFSpeechRecognizer` supports on-device recognition on macOS (with a per-request audio duration limit, so long dictation must be chunked or restarted).
- **Decision:** (1) The command bar is a plain text field, so Wispr Flow works with zero integration. (2) For built-in voice, ship a small **Swift helper** (child process speaking JSON lines over stdio, or an N-API addon) that wraps `AVAudioEngine` + `SFSpeechAudioBufferRecognitionRequest` with `requiresOnDeviceRecognition = true`. The main process relays partial and final transcripts to the renderer. Permissions: Microphone + Speech Recognition, with `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` in Info.plist.
- **Consequences:** + Private, offline, free, no dependence on Wispr. − A Swift build step and code-signing of the helper; macOS-only. Commands are short, so the duration limit is rarely hit.
- **Spike:** Confirm that newer macOS releases don't offer a better speech API than `SFSpeechRecognizer` before building. Also confirm on-device support for the owner's language/locale.
- **Alternatives:** `whisper.cpp` local model (better accuracy, heavier, a model download, a possible later upgrade); cloud STT (violates local-first/no-network); Web Speech API (unreliable in Electron).

### ADR-005: Deterministic command parser (rules + fuzzy match) in v1
- **Status:** Accepted
- **Context:** Owner wants no LLMs for now, yet a "talk to it and it updates itself" experience.
- **Decision:** Ordered intent rules (regex/grammar) → entity extraction (`chrono-node` dates, `fuse.js` for project/task names) → typed `Command`. Default intent is dump. Ambiguity prompts a chooser, never a silent guess.
- **Consequences:** + Predictable, instant, offline, testable with a table of utterances. − Rigid phrasing; users must learn about 10 verbs. Mitigated by the dump fallback, a "?" help overlay, and Phase 3 LLM fallback (ADR-006).
- **Alternatives:** LLM-only parsing (rejected for v1 by owner); NLU libraries like `compromise` or `nlp.js` (reasonable add-on if the grammar grows unwieldy).

### ADR-006: OpenAI-compatible provider abstraction, built now, activated in Phase 3
- **Status:** Accepted
- **Context:** Owner wants to plug in any OpenAI-style provider later, and not be locked into one vendor.
- **Decision:** Define `LLMProvider {baseUrl, apiKeyRef, model, headers}` and an `LLMClient` over the OpenAI chat-completions contract (including tool calls and streaming), living in the main process. Keys are in Keychain via `safeStorage`. LLM output may only produce validated `Command` objects (zod schema), never raw DB writes. A feature flag keeps it dark in v1.
- **Consequences:** + One integration covers OpenAI, OpenRouter, Groq, Ollama, LM Studio, and others. − "OpenAI-compatible" is loose: tool-calling and streaming support vary by provider, so the client needs capability detection and a plain-JSON fallback. Azure and a few vendors need path or header quirks (covered by custom headers and base-URL config).
- **Alternatives:** Vercel AI SDK or LangChain (more abstraction than needed, extra dependency weight); per-vendor SDKs (lock-in, more code).

### ADR-007: Everything is a `Command`; undo and audit come from the command log
- **Status:** Accepted
- **Context:** Several input sources (voice, text, UI, later LLM) must mutate the same state safely.
- **Decision:** A single `dispatch(command)` in the main process validates, applies in a transaction, writes inverse data to `command_log`, and emits a state diff to the renderer.
- **Consequences:** + Uniform undo, testing, and safe LLM integration. − Every UI mutation must route through commands, which adds some upfront boilerplate.
- **Alternatives:** Direct CRUD IPC endpoints (simpler now, but undo and LLM safety become retrofits).

### ADR-008: Security posture for the renderer
- **Status:** Accepted
- **Decision:** `contextIsolation`, no Node in the renderer, sandbox on, strict CSP, a minimal typed preload API, no remote content loaded, navigation locked. All network access lives in the main process.
- **Consequences:** + Keeps future LLM keys and local data safe. − Some templates need adjustment (see ADR-002).

## 11. Success metrics (personal, self-measured)

- ≥ 80% of captures made via hotkey or voice rather than clicking.
- Median capture time < 3 s.
- Wrap-up completed on ≥ 5 of 7 days, median duration < 2 min.
- < 10% of voice commands needing correction after Phase 1 grammar tuning (tracked via Undo rate in the command log).
- Zero data-loss incidents.

## 12. Risks and open questions

| # | Risk / question | Mitigation / owner |
|---|---|---|
| R1 | Rule-based parser feels too rigid compared with an LLM | Dump fallback + utterance test corpus built from my real dictation; Phase 3 fallback |
| R2 | Native Swift speech helper adds build/signing complexity | Time-boxed spike in Phase 2. Wispr Flow still works regardless |
| R3 | On-device speech accuracy or locale support is weaker than Wispr's | Keep Wispr as the primary path, with built-in voice as a convenience |
| R4 | Template goes stale or enables insecure defaults | Pin versions, audit config after scaffolding (ADR-002/008) |
| R5 | "OpenAI-compatible" providers differ in tool-calling support | Capability detection + JSON-mode fallback (ADR-006) |
| Q1 | Do you need the app distributed (signed DMG) or only run locally? Affects notarisation work | Owner |
| Q2 | Preferred wrap-up time and week start day? | Owner (defaults: 17:30, Monday) |
| Q3 | Should "tomorrow" auto-roll at midnight, or only on wrap-up confirmation? | Owner (default: on confirmation, with midnight fallback) |
| Q4 | Any must-have integrations earlier than Phase 4 (calendar, GitHub)? | Owner |

## 13. Interpretation notes

Your brief said both "shouldn't use any LLMs for now" and "make sure you use LLM providers". I resolved this as **no LLM behaviour in v1, with the provider layer designed and stubbed now** (ADR-006, §7). "TT speech-to-text model" I read as Apple's built-in on-device speech recognition (ADR-004). Correct me if either reading is off.

---

## 14. Addendum v0.2 (implementation changes)

**What changed since v0.1, and why**

| Change | Reason |
|---|---|
| **No built-in speech recognition.** Wispr Flow types into the command bar. The Swift speech bridge, push-to-talk and FR-3 are dropped. | Owner decision. |
| **UI is four task-oriented tabs + Activity:** Today (morning plate), Quick Dump (see / sort / make a to-do), My Projects (status + deadlines), End of the Day (done / carryover / follow-up tomorrow). Replaces the single four-panel screen. | Owner request. |
| **Projects have deadlines.** `project.setDue`, deadline chips (overdue / due today / N days left), deadline alerts on Today and End of the Day. | Owner request. |
| **Dump triage** sends an item to a to-do (today or tomorrow), to a project, or discards it. | Owner request. |
| **Activity tracking via the macOS Accessibility API**, with per-service adapters (see ADR-010). | Owner request. |
| **shadcn/ui** (radix base, Tailwind v4) for all UI components. | Owner request (ADR-011). |

### ADR-009: Wispr Flow is the only voice path
- **Status:** Accepted. **Supersedes:** ADR-004.
- **Decision:** The command bar is a plain, always-focusable text field (`⌘K`), IME-safe (ignores Enter during composition). No speech APIs in the app.
- **Consequences:** + No native speech code, permissions or signing. - Voice depends on Wispr Flow running.

### ADR-010: Activity tracking via Accessibility API, metadata-only by default
- **Status:** Accepted
- **Context:** The owner wants activity tracked across email, messaging, social and work apps using the macOS accessibility layer. Window titles can contain message subjects, contact names and addresses, so collection is minimised and opt-in.
- **Decision:**
  - A small Swift helper (`native/ax-tracker.swift`) polls the focused app, its window title, the browser page URL (via the AXWebArea) and idle time. It never reads field contents or page text, and **fails closed**: title and URL are withheld when the focused element is a secure field or cannot be inspected.
  - Adapters (`src/main/adapters/registry.ts`, ~100 services: Gmail, Outlook, Apple Mail, WhatsApp, Telegram, Slack, Discord, X, LinkedIn, Instagram, Facebook, Reddit, YouTube, GitHub, Notion, Figma, VS Code, Zoom ...) map app/host to a service, category and coarse activity kind (reading, composing, messaging, watching ...).
  - **Stored per row:** timestamps, app, bundle id, service, category, kind, idle flag, and the page **host only**. Raw window titles are **never** stored. A redacted `detail` (thread/chat/doc name) and a cleaned URL path are stored only if the user turns on "Capture detail", and turning it off deletes them. Login/auth/reset pages are recorded as "signing in" with no detail.
  - **Opt-in** (off on first run), 30-day retention, one-click purge (secure delete + vacuum), database file mode 0600.
- **Consequences:** + Useful, private by construction. - Accessibility permission is required and is attached to the app (Electron in dev). Every visited browser host is recorded, which the Activity tab states plainly. Adapters match hosts/bundle ids heuristically and need upkeep.

### ADR-011: shadcn/ui for the interface
- **Status:** Accepted
- **Decision:** shadcn/ui (radix base, `radix-nova` style) with Tailwind v4. All 61 components are installed under `src/renderer/src/components/ui` (vendored, excluded from lint). Theme tokens are oklch, follow the OS light/dark setting, and add `success` and `warning` tokens.
- **Consequences:** + Accessible primitives (Tabs, Dialog, Select, Checkbox, Alert, Empty, Sonner). - The shadcn CLI does not detect electron-vite; it needs path aliases in the root `tsconfig.json`, and generated imports of `cn` were rewritten to `@renderer/lib/utils`.

### ADR-012: AI assist through the user's own Claude / Codex subscription
- **Status:** Accepted. **Supersedes:** the OpenAI-compatible provider layer of ADR-006 for v1 (still a valid future option).
- **Decision:** Optional, off by default. When the rule parser doesn't match, Dash can call the user's signed-in `claude` or `codex` CLI headlessly (no tools, empty temp dir, API-key env vars stripped so it can never bill an API account). The model returns schema-constrained JSON; Dash validates every command and id before applying (ADR-003) and every change is undoable. It also suggests Quick Dump triage, which the user applies explicitly. Failures fall back to Quick Dump. No API key is stored.
- **Consequences:** + Uses a subscription the user already pays for; no secrets in Dash. - Needs the CLIs installed and signed in; 4-20 s latency; depends on the providers' terms for CLI use.

### ADR-013: Data safety
- **Decision:** Daily `VACUUM INTO` backup (14 kept), pre-migration and pre-restore snapshots, JSON/Markdown export (activity excluded unless opted in), restore from backup, and "Delete all data" (typed confirmation, secure delete, removes backups). All files mode 0600.

### Status of requirements

| Area | Status |
|---|---|
| Command pipeline, undo, input validation, SQLite store | Done, tested |
| Rule-based parser (incl. carry / drop / defer / next action) | Done, tested |
| Five tabs, light and dark, shadcn UI | Done, tested end to end on the packaged app |
| Activity tracker (event-driven helper, adapters, exclude list, timeline) | Done, tested live |
| Wrap-up ritual, summary history, streak, stale-task handling, project health, notes sheet (FR-9..FR-14) | Done, tested |
| Global hotkey capture, menu-bar tray, end-of-day reminder (FR-1, FR-9) | Done, tested; eyeball the panel behaviour once on a real desktop |
| Export, daily backup, restore, delete-all (NFR-3) | Done, tested |
| AI assist (ADR-012): parser fallback, Quick Dump triage | Done, tested live against both CLIs |
| Packaging | Unsigned build verified (see docs/RELEASE.md) |
| Signing, notarisation | Configured, **not tested**: needs the owner's Apple Developer account |
| Auto-update | Not built (no feed). Add `electron-updater` and a real feed first |

> `docs/` holds an earlier draft PRD and ADRs written in a previous session (web app, LLM-first). They conflict with this document and have not been changed.
