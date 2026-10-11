# Dayfold: Loom demo script (about 5 minutes)

**Audience:** someone who has never seen Dayfold. **Goal:** they leave knowing three things: capture is instant, the day closes with a ritual, and everything stays on your Mac.

Say the quoted lines in your own words. The **Do** column is the part to rehearse.

---

## Before you hit record (10 minutes, do it once)

1. **Fresh demo data.** Open Dayfold, then Settings → **Exit Demo Mode** (only if it is on), then Settings → **Start Demo Mode**. This rebuilds the sample data relative to today, so "due yesterday" and "Tue" read correctly. Do this on the day you record, in the morning if you can, so Activity shows a fuller day.
2. **Do not demo after using it.** Wrapping up and adding tasks change the demo data. If you flub a take, repeat step 1 for a clean reset. Your real data is untouched the whole time.
3. **Quit the dev copy** (`npm run dev`). Two copies on the same data folder can conflict.
4. **Clean screen.** Do Not Disturb on. Hide the Dock (⌥⌘D). Close Slack and mail. Set the window to about 1280 × 860 so text is readable at Loom's default size.
5. **Loom:** record the **Dayfold window only**, 1080p, mic on. Turn the camera bubble on for the intro and the outro, and off if it covers the command bar.
6. **Skip AI assist.** It needs a signed-in Claude or Codex CLI. The saved review for yesterday works without it, so you do not need it.
7. Do one dry run of the typed commands in section 3. They are verified, but you should have them in your fingers.

**Demo data cheat sheet:** 6 projects (4 active, 1 paused, 1 done). Today's plate has 6 tasks. "Book flights for Lisbon" is stale (carried 3×). There are 5 Inbox items and a 6-day wrap-up streak.

---

## 1. Hook and problem (0:00 to 0:30)

**On screen:** Today tab, Demo Mode badge visible.

> "Most task apps ask you to decide a list, a date and a tag before you can write anything down. So you don't, and the week drifts. Dayfold is a local-first dashboard for macOS built around one idea: capture first, organize later, and close every day on purpose."

**Do:** point at the header: Today, My Projects, Activity.

---

## 2. Today: your plate at a glance (0:30 to 1:20)

**On screen:** Today tab.

> "This is Monday morning. Six things on my plate, two already done, and the progress bar tells me where I stand."

**Do:**
1. Point at **Record the 90-second demo video**: "In progress, due Tuesday. Dates read like a person would say them."
2. Point at the red **stale · carried 3×** badge on *Book flights for Lisbon* and the warning above it.
   > "Dayfold notices when I keep pushing the same task. After three carries it stops letting me ignore it and asks me to break it down, defer it or drop it."
3. Click **Defer**, pick a date, and say "this is a decision, not a silent carry." (Then press **⌘Z** or say "undo" so the demo data stays the same. Skip this step if you are short on time.)
4. Scroll to the **Inbox** section: "Five raw thoughts I captured without sorting. They wait here until the wrap-up."

---

## 3. The command bar (1:20 to 2:20)

**On screen:** the bar at the bottom. Click into it.

> "One text box runs the whole app. Typed or dictated: it works with Wispr Flow or any dictation tool because it is just a text field."

**Type these, one at a time, pausing on the confirmation toast each time:**

| Type | What happens | Say |
|---|---|---|
| `add task email the press kit to Dayfold 1.0 launch` | New task in that project | "Natural language, fuzzy project match." |
| `move reply to beta feedback to tomorrow` | Task leaves today's plate | "Plans change. One sentence." |
| `due Friday: send the press kit` | New task due Friday | "Date phrases just work." |
| `note on Dayfold 1.0 launch: pricing decision is Thursday` | Appends a project note | "Notes go to the right project." |
| `done with the demo video` | A **chooser** appears (two tasks match) | "It never guesses silently. It asks." Pick **Record the 90-second demo video**. |
| `undo` | Last change reverts | "Everything is undoable." |

More that work, if you have time: `sort my tasks`, `what should I do next` (suggests the top task and why), `what's due today`, `what is overdue`, `how many tasks do I have`, `show projects`, `open activity`, and `help` (lists everything). `remind me to call mum tomorrow` creates a task planned for tomorrow.

Optional: click the suggestion chips (**add task…**, **done with…**, **new project…**, **move…**) to show the bar teaches its grammar.

> "And if it doesn't understand me, nothing is lost. It goes to the Inbox." Type `remind me to buy a USB-C cable` and show it land in the Inbox.

---

## 4. Capture from anywhere (2:20 to 2:50)

**Do:** switch to another app (Finder or a browser) so it is clear Dayfold is not in front. Press **⌥Space**. A small capture bar floats above everything. Type `idea: snooze to a weekday from the wrap-up` and press **Enter**.

> "Under three seconds, from any app, no decisions. That's the whole capture promise."

Switch back to Dayfold and show the new Inbox item.

---

## 5. Projects (2:50 to 3:30)

**On screen:** My Projects tab.

> "Four active projects, each with the next action and a deadline countdown. Admin has five days left, the launch has nine."

**Do:** click **Dayfold 1.0 launch**. Show the goal, the **next action** ("Record the 90-second demo video"), the due date and the markdown notes with the launch checklist. Close it. Open **Paused and done** and mention the paused conference talk and the finished onboarding emails.

> "A project is a goal, a next action and notes. No boards, no Gantt charts, on purpose."

---

## 6. The wrap-up ritual (3:30 to 4:30)

**On screen:** Today tab. Click **Wrap up** (or type `wrap up`).

> "This is the part I care about most. Every day ends here, in about two minutes."

**Do (keyboard only, say the keys aloud):**
1. First card is *Book flights for Lisbon*. Point out the carried-3× prompt. Press **F** (defer), choose a date, **Enter**.
2. Next task: press **D** (done). The next: **C** (carry to tomorrow). Mention **X** drops and **B** breaks down.
3. Show **Undo (U)**: "Every choice can be undone."
4. Step through **Inbox** (turn each captured thought into a task or discard it) and **Tomorrow** (the list it built for me).
5. Finish. Point at the streak and the wrap-up summary: "It remembers what I did, carried, deferred and dropped. Six days in a row here."

> "I don't end the day with a vague list in my head. I end it with tomorrow already planned."

---

## 7. Activity: where the time went (4:30 to 5:20)

**On screen:** Activity tab.

> "Optional, off by default and local. Dayfold can record which app is in front and for how long. It never reads field contents, banking and password sites are skipped, and password managers are excluded by default."

**Do:**
1. Show the **timeline** and **Top apps** (VS Code, Notion, Terminal, Claude).
2. Use the date arrows to go back to **yesterday** or **Saturday**, where there is a full day. Show the totals and "longest focus".
3. Open **Work sessions**: "Short detours into Slack don't split a block of focus. Each session suggests a follow-up, and **Add to to-do** puts it on my list."
4. Open **Day review** for yesterday (a saved review, no AI needed): "With an AI assistant signed in, it writes what got done and what I probably missed. It runs on my own Claude subscription: no API key, and nothing leaves the Mac unless I ask for the review."

---

## 8. Local-first close (5:20 to 5:50)

**On screen:** Settings (gear icon).

> "Everything is a single SQLite file on this Mac. No account, no sync, no telemetry."

**Do:** point at **Backups** (daily, 14 kept), **Export** (JSON or Markdown) and the **Demo Mode** section.

> "This is Demo Mode: sample data in a separate database. My real data is never touched. One click and I'm back."

Click **Exit Demo Mode** if you want to end on your real data, or leave it on and just stop the recording.

**Outro (turn the camera bubble back on):**
> "That's Dayfold: capture in three seconds, one command bar, and a daily wrap-up that plans tomorrow. It's a macOS app, fully local. Thanks for watching."

---

## Timing, if you need a 3-minute cut

Keep: 1 (hook), 3 (command bar, three commands), 4 (hotkey), 6 (wrap-up, keys only). Skip: 2 step 3, 5, 7, and the optional chips.

## If something goes wrong on camera

- **A command opens a chooser you didn't expect:** that is the app asking, not failing. Say "it asks when it's unsure" and pick one.
- **You marked the wrong thing:** type `undo` or press ⌘Z, and keep talking.
- **Activity for today looks short:** it is drawn from the hours that have passed so far. Click back one day. Yesterday and earlier are full.
- **Need a clean slate:** Settings → Exit Demo Mode → Start Demo Mode (about 5 seconds).
