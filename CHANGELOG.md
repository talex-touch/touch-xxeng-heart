# Changelog

## v0.2.1 - 2026-07-29

Changes since v0.2.0.

### Features
- redesign the AI dialog in a ChatGPT-style visual language (b0019a6)

### Maintenance
- fix workspace install in the auto-version workflow (461c97b)

## v0.1.6 - 2026-07-16

Changes since v0.1.5.

### Features
- support video speed controls across players (1d27fc3)

### Fixes
- harden document-start and fullscreen playback UI (e7073b9)
- address page enhancer review feedback (b223149)
- adapt video gesture for Mac trackpads (bafef1f)
- harden page enhancer runtime (23213d5)

### Changes
- Merge pull request #2 from liuxinrong00/fix/page-enhancer-runtime (6c3c915)

## v0.2.0 - 2026-07-28

### Features
- retrieve relevant page excerpts for the AI dialog instead of injecting the first 1200 characters of the page, and send real multi-turn messages so the transcript prefix stays cacheable
- embed the GitHub digest card above the About block with sticky scrolling, degrading through several markups before falling back to a floating panel
- collapse support on every card, including the AI dialog and media toolbar which previously had none
- publish the Lexi privacy policy at `https://lexi.tagzxia.com/privacy`
- add a CWS beta channel via `pnpm pack:beta`

### Fixes
- stop settings edits from mutating the shared `defaultSettings` singleton
- stop every surface from writing the whole settings blob back to storage on mount
- render a successful AI connection test in green instead of red
- run hover and pointer-up handlers once per interaction instead of two to four times
- avoid a duplicate context-menu id error on extension update
- guard a non-numeric cache limit from reaching the digest pruner as `NaN`
- report sub-kilobyte sizes in bytes rather than as `0.3 KB`
- keep trend bars inside their container
- remove the unnecessary `tabs` permission from Chrome packages

### Changes
- cache settings and vocabulary until storage changes, instead of re-parsing them on every scroll frame, keystroke and selection
- extract a shared UI layer for the in-page cards and shared Vue components for the settings surfaces

## v0.1.7 - 2026-07-19

### Fixes
- build development extension views as local assets without a Vite server dependency

### Changes
- Support video speed controls for any detected `<video>` tag, including open Shadow DOM and embedded frames.

## v0.1.5 - 2026-07-09

Changes since v0.1.4.

### Maintenance
- handle pr feedback and automate releases (8162240)

### Changes
- Merge branch 'pr-1' (32ea6a3)
- change the color of window and change the size of window (abb065e)


