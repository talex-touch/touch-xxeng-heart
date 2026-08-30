# Changelog

## v0.3.1 - 2026-08-30

Changes since v0.3.0.

### Features
- translate the main column first and drain the page in batches (e6407eb)

### Fixes
- retain Lexi dialog context (5e6c657)

## v0.3.0 - 2026-08-28

Changes since v0.2.14.

### Features
- mark named entities and resolve them against the page's domain (d6bbcb2)
- reserve the subtitle source contract (21c7ffa)
- classify translation failures so they can be reported once (fb64318)
- detect the page language and serve Japanese and Korean (8670cb6)

### Fixes
- keep vocabulary in restored translations and explain failures (d481111)
- release the worker when a request is cancelled or hangs (cdb0192)

### Docs
- add a user-facing feature guide (04ab19d)

## v0.2.14 - 2026-08-27

Changes since v0.2.13.

### Features
- add the entity detection section to the landing page (a7ececd)
- restructure page translation into per-page control and central rules (05b1b5b)

### Docs
- repoint mockup image fills after the move into design/ (463ecf5)
- backfill the v2 side-panel states into the extension mockup (e89fd9e)

### Maintenance
- check in Pencil design sources and the options store screenshot (f2168ac)
- move the side panel onto Lexi tokens and quiet in-page translations (5142c56)

## v0.2.13 - 2026-08-24

Changes since v0.2.12.

### Features
- add scoped page translation and festival themes (739b434)

## v0.2.12 - 2026-08-24

Changes since v0.2.11.

### Fixes
- exclude attachments from page translation (d110182)

## v0.2.11 - 2026-08-22

Changes since v0.2.10.

### Features
- unify translation dispatch and rules (1b1f25d)
- gate page translation and enforce quotas (690524a)

### Tests
- stabilize settings sync coverage (d366a74)
- align extension release coverage (39d48b9)

### Docs
- add LinuxDo community badge (9dcc297)

### Maintenance
- publish to the chrome web store on tag and stop auto-tagging main (9c12951)

## v0.2.10 - 2026-08-12

Changes since v0.2.9.

### Features
- follow scroll, page-theme dark material, quieter marks, general vocabulary (cc6c189)

## v0.2.9 - 2026-08-12

Changes since v0.2.8.

### Features
- archive known words from the hover card and taper exposure (04a6336)

## v0.2.8 - 2026-08-12

Changes since v0.2.7.

### Features
- run AI in the extension worker and rework page reading (04c6895)

## v0.2.7 - 2026-08-06

Changes since v0.2.6.

### Features
- route AI providers by protocol and sync settings (bf677c5)

## v0.2.6 - 2026-08-03

Changes since v0.2.5.

### Features
- add multi-platform content digests (db0e0df)

## v0.2.5 - 2026-08-03

Changes since v0.2.4.

### Features
- improve learning controls and extension packaging (b3c5a5b)

## v0.2.4 - 2026-08-02

Changes since v0.2.3.

### Fixes
- align Cloudflare Pages deployment (cbad353)

## v0.2.3 - 2026-08-02

Changes since v0.2.2.

### Features
- redesign Lexi product surfaces (250454f)

### Refactors
- harden extension runtime and endpoint security (144e95c)

## v0.2.2 - 2026-07-29

Changes since v0.2.1.

### Maintenance
- dispatch the extension build after auto version bumps (32dd7f9)

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

















