import { collapsibleStyles } from '~/contentScripts/ui/collapsible'

function getPageStyleContent(customCss = '') {
  return `
    /* Shared design tokens, mirrored from the official site (apps/site main.css):
       near-neutral surfaces, one blue accent, purple only for product entities. */
    .lexi-token,
    .lexi-token-tooltip,
    .lexi-toast,
    .lexi-selection-translation,
    .lexi-page-translation,
    .lexi-chat-translation,
    .lexi-media-highlight,
    .lexi-media-toolbar,
    .lexi-dialog {
      --lexi-ink: #0d0d0d;
      --lexi-ink-2: #5c5c66;
      --lexi-ink-3: #8e8e9a;
      --lexi-line: #e6e6ea;
      --lexi-line-strong: #d8d8de;
      --lexi-bg: #ffffff;
      --lexi-bg-subtle: #f7f7f8;
      --lexi-accent: #1976ff;
      --lexi-accent-ink: #0b57c7;
      --lexi-accent-soft: #edf3ff;
      --lexi-tech-soft: #e8f0fe;
      --lexi-prod: #7c5cff;
      --lexi-prod-soft: #f0ecff;
      --lexi-glass-bg: rgba(255, 255, 255, 0.76);
      --lexi-glass-blur: blur(26px) saturate(180%);
      --lexi-glass-shadow: 0 16px 40px -8px rgba(13, 13, 13, 0.17);
      --lexi-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif;
      --lexi-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      /* Overwritten per card from the anchored paragraph's computed type, so an injected
         block reads at the page's own size and face instead of a fixed 14px. */
      --lexi-card-font-family: var(--lexi-font-sans);
      --lexi-card-font-size: 14px;
    }

    /* Dark pages get the iOS dark material: same structure, inverted surfaces. */
    [data-lexi-theme="dark"] .lexi-token,
    [data-lexi-theme="dark"] .lexi-token-tooltip,
    [data-lexi-theme="dark"] .lexi-toast,
    [data-lexi-theme="dark"] .lexi-selection-translation,
    [data-lexi-theme="dark"] .lexi-page-translation,
    [data-lexi-theme="dark"] .lexi-chat-translation,
    [data-lexi-theme="dark"] .lexi-media-highlight,
    [data-lexi-theme="dark"] .lexi-media-toolbar {
      --lexi-ink: #f2f2f4;
      --lexi-ink-2: #b6b6c2;
      --lexi-ink-3: #8e8e9a;
      --lexi-line: rgba(255, 255, 255, 0.12);
      --lexi-line-strong: rgba(255, 255, 255, 0.22);
      --lexi-bg: #1c1c1e;
      --lexi-bg-subtle: rgba(255, 255, 255, 0.06);
      --lexi-accent: #6fa8ff;
      --lexi-accent-ink: #8db8ff;
      --lexi-accent-soft: rgba(111, 168, 255, 0.16);
      --lexi-tech-soft: rgba(111, 168, 255, 0.16);
      --lexi-prod: #a18bff;
      --lexi-prod-soft: rgba(161, 139, 255, 0.18);
      --lexi-glass-bg: rgba(28, 28, 30, 0.72);
      --lexi-glass-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.6);
    }

    [data-lexi-theme="dark"] .lexi-selection-translation[data-lexi-loading="true"] {
      background: linear-gradient(100deg, rgba(28, 28, 30, 0.86) 0%, rgba(38, 42, 52, 0.84) 48%, rgba(28, 28, 30, 0.86) 100%);
      background-size: 220% 100%;
    }


    [data-lexi-theme="dark"] .lexi-media-toolbar__button:first-child {
      background: #ececec;
      color: #0d0d0d;
    }

    [data-lexi-theme="dark"] .lexi-media-toolbar__button:first-child:hover {
      background: #ffffff;
    }

    @supports not (backdrop-filter: blur(4px)) {
      [data-lexi-theme="dark"] .lexi-token-tooltip,
      [data-lexi-theme="dark"] .lexi-selection-translation,
      [data-lexi-theme="dark"] .lexi-media-toolbar {
        background: rgba(28, 28, 30, 0.97);
      }
    }

    /* Replaced word: keep the page's own type, mark it with a quiet underline
       only; the tint appears on hover. Layout is untouched (no padding). */
    .lexi-token {
      border-radius: 3px;
      background: transparent;
      padding: 0;
      color: inherit;
      font-weight: inherit;
      cursor: help;
      text-decoration: underline;
      text-decoration-color: rgba(25, 118, 255, 0.42);
      text-decoration-thickness: 1.5px;
      text-underline-offset: 3px;
      transition: background-color 0.15s ease, text-decoration-color 0.15s ease;
    }

    .lexi-token:hover {
      background: var(--lexi-accent-soft);
      text-decoration-color: var(--lexi-accent);
    }

    [data-lexi-theme="dark"] .lexi-token {
      text-decoration-color: rgba(111, 168, 255, 0.48);
    }

    /* Product entity: text untouched, one small domain dot after it (.ent). */
    .lexi-token-product {
      background: transparent;
      padding: 0;
      color: inherit;
      font-weight: inherit;
      border-radius: 3px;
      text-decoration: none;
    }

    .lexi-token-product::after {
      content: "";
      display: inline-block;
      width: 4.5px;
      height: 4.5px;
      margin-left: 3px;
      border-radius: 50%;
      background: var(--lexi-prod);
      vertical-align: 0.18em;
    }

    .lexi-token-product:hover {
      background: var(--lexi-prod-soft);
      color: var(--lexi-ink);
    }

    /* Hover card: the frosted definition card from the official hero mock.
       Kept in layout while closed so it can be measured, then faded in/out. */
    .lexi-token-tooltip {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483647;
      display: grid;
      gap: 10px;
      width: min(360px, calc(100vw - 32px));
      border: 1px solid var(--lexi-line);
      border-radius: 14px;
      background: var(--lexi-glass-bg);
      -webkit-backdrop-filter: var(--lexi-glass-blur);
      backdrop-filter: var(--lexi-glass-blur);
      box-shadow: var(--lexi-glass-shadow);
      color: var(--lexi-ink);
      padding: 14px 16px;
      font: 13px/1.6 var(--lexi-font-sans);
      opacity: 0;
      visibility: hidden;
      transform: translateY(4px) scale(0.98);
      pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease, visibility 0s linear 160ms;
    }

    .lexi-token-tooltip[data-lexi-open="true"] {
      opacity: 1;
      visibility: visible;
      transform: none;
      pointer-events: auto;
      transition: opacity 160ms ease, transform 160ms ease;
    }

    @supports not (backdrop-filter: blur(4px)) {
      .lexi-token-tooltip {
        background: rgba(255, 255, 255, 0.97);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .lexi-token-tooltip {
        transition: none;
        transform: none;
      }
    }

    .lexi-token-tooltip * {
      box-sizing: border-box;
      font-family: var(--lexi-font-sans);
    }

    .lexi-hover-card__head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .lexi-hover-card__word {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--lexi-ink);
    }

    .lexi-hover-card__original {
      color: var(--lexi-ink-3);
      font-size: 12px;
    }

    .lexi-hover-card__tag {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      background: var(--lexi-tech-soft);
      padding: 3px 9px;
      color: var(--lexi-accent);
      font-size: 10.5px;
      font-weight: 600;
      line-height: 1.5;
      white-space: nowrap;
    }

    .lexi-hover-card__tag--product {
      background: var(--lexi-prod-soft);
      color: var(--lexi-prod);
    }

    .lexi-hover-card__phonetic {
      color: var(--lexi-ink-3);
      font-size: 12px;
      font-family: var(--lexi-font-mono);
    }

    .lexi-hover-card__def {
      margin: 0;
      color: var(--lexi-ink-2);
      font-size: 13px;
      line-height: 1.8;
    }

    .lexi-hover-card__example {
      margin: 0;
      color: var(--lexi-ink-3);
      font-size: 12px;
      line-height: 1.7;
    }

    .lexi-hover-card__divider {
      margin: 0;
      border: 0;
      border-top: 1px solid var(--lexi-line);
    }

    .lexi-hover-card__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .lexi-hover-card__action {
      border: 0;
      background: transparent;
      padding: 0;
      color: var(--lexi-accent);
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.4;
    }

    .lexi-hover-card__action:hover {
      color: var(--lexi-accent-ink);
    }

    .lexi-hover-card__tags {
      overflow: hidden;
      color: var(--lexi-ink-3);
      font-size: 11px;
      font-family: var(--lexi-font-mono);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lexi-toast {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      left: 50%;
      bottom: 28px;
      z-index: 2147483647;
      max-width: min(420px, calc(100vw - 32px));
      border-radius: 10px;
      background: rgba(13, 13, 13, 0.92);
      box-shadow: 0 16px 40px -8px rgba(13, 13, 13, 0.3);
      color: #ffffff;
      padding: 10px 14px;
      font: 13px/1.5 var(--lexi-font-sans);
      pointer-events: none;
      transform: translateX(-50%) translateY(10px);
      opacity: 0;
      animation: lexi-toast-enter 180ms ease-out forwards;
    }

    .lexi-toast[data-lexi-closing="true"] {
      animation: lexi-toast-exit 200ms ease forwards;
    }

    .lexi-selection-translation {
      all: initial;
      box-sizing: border-box;
      display: block;
      position: relative;
      max-width: min(100%, 64rem);
      margin: 0.85em 0;
      border: 0;
      border-radius: 12px;
      background: var(--lexi-glass-bg);
      box-shadow: var(--lexi-glass-shadow);
      backdrop-filter: var(--lexi-glass-blur);
      -webkit-backdrop-filter: var(--lexi-glass-blur);
      padding: 0.7em 0.85em;
      color: var(--lexi-ink);
      /* Longhands, not the font shorthand: the family is copied from the page and one
         odd value there would otherwise invalidate the size and line-height with it. */
      font-family: var(--lexi-card-font-family);
      font-size: var(--lexi-card-font-size);
      line-height: 1.65;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      opacity: 1;
      overflow: hidden;
      animation: lexi-card-enter 180ms ease-out both;
      transform-origin: top left;
    }

    @supports not (backdrop-filter: blur(4px)) {
      .lexi-selection-translation {
        background: rgba(255, 255, 255, 0.97);
      }
    }

    .lexi-selection-translation[data-lexi-collapsed="true"] {
      display: inline-flex;
      width: fit-content;
      max-width: min(100%, 22rem);
      border: 0;
      border-radius: 999px;
      background: var(--lexi-accent-soft);
      padding: 0;
      color: var(--lexi-accent-ink);
    }

    .lexi-selection-translation[data-lexi-loading="true"] {
      background: linear-gradient(100deg, rgba(255, 255, 255, 0.86) 0%, rgba(237, 243, 255, 0.84) 48%, rgba(255, 255, 255, 0.86) 100%);
      background-size: 220% 100%;
      animation: lexi-card-enter 180ms ease-out both, lexi-shimmer-surface 1000ms ease-in-out infinite;
    }

    .lexi-selection-translation[data-lexi-loading="true"]::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(105deg, transparent 0%, rgba(25, 118, 255, 0.08) 46%, transparent 78%);
      transform: translateX(-120%);
      animation: lexi-shimmer-sweep 1000ms ease-in-out infinite;
      pointer-events: none;
    }

    .lexi-selection-translation__header {
      all: initial;
      display: flex;
      box-sizing: border-box;
      align-items: center;
      justify-content: space-between;
      gap: 0.65em;
      margin-bottom: 0.18em;
    }

    .lexi-selection-translation[data-lexi-collapsed="true"] .lexi-selection-translation__header,
    .lexi-selection-translation[data-lexi-collapsed="true"] .lexi-selection-translation__body {
      display: none;
    }

    .lexi-selection-translation__label {
      all: initial;
      display: inline-block;
      box-sizing: border-box;
      margin: 0;
      background: var(--lexi-accent-soft);
      color: var(--lexi-accent-ink);
      font: 600 11px/1.5 var(--lexi-font-sans);
      padding: 3px 9px;
      border-radius: 999px;
      white-space: nowrap;
    }

    .lexi-selection-translation__actions {
      all: initial;
      display: inline-flex;
      box-sizing: border-box;
      align-items: center;
      gap: 0.25em;
    }

    .lexi-selection-translation__icon-button {
      all: initial;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.65em;
      height: 1.65em;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--lexi-ink-3);
      cursor: pointer;
      font: 13px/1 var(--lexi-font-sans);
      user-select: none;
    }

    .lexi-selection-translation__icon-button:hover {
      border-color: var(--lexi-line);
      background: var(--lexi-accent-soft);
      color: var(--lexi-accent-ink);
    }

    .lexi-selection-translation__body {
      all: initial;
      display: block;
      box-sizing: border-box;
    }

    .lexi-selection-translation__text {
      all: initial;
      display: inline;
      color: var(--lexi-ink);
      font-family: var(--lexi-card-font-family);
      font-size: var(--lexi-card-font-size);
      line-height: 1.65;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      opacity: 1;
    }

    .lexi-selection-translation__text[data-lexi-revealing="true"] {
      animation: lexi-text-reveal 220ms ease-out both;
      will-change: opacity, filter, transform;
    }

    .lexi-selection-translation__chunk[data-lexi-new="true"] {
      animation: lexi-text-reveal 180ms ease-out both;
      will-change: opacity, filter, transform;
    }

    .lexi-selection-translation__char[data-lexi-new="true"] {
      display: inline-block;
      animation: lexi-char-reveal 190ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
      will-change: opacity, filter, transform;
    }

    .lexi-selection-translation__text[data-lexi-loading="true"] {
      display: inline;
      color: var(--lexi-accent-ink);
      opacity: 0.62;
    }

    .lexi-selection-translation__detail {
      all: initial;
      display: block;
      margin-top: 0.45em;
      color: var(--lexi-ink-2);
      font: 12px/1.55 var(--lexi-font-sans);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .lexi-selection-translation__status {
      all: initial;
      display: flex;
      box-sizing: border-box;
      align-items: center;
      justify-content: space-between;
      gap: 0.75em;
      margin-top: 0.8em;
      padding-top: 0.6em;
      border-top: 1px solid var(--lexi-line);
      color: var(--lexi-ink-3);
      font: 11px/1.4 var(--lexi-font-sans);
    }

    .lexi-selection-translation__locate {
      all: initial;
      box-sizing: border-box;
      color: var(--lexi-accent-ink);
      cursor: pointer;
      font: 600 11px/1.4 var(--lexi-font-sans);
    }

    .lexi-selection-translation__locate:hover,
    .lexi-selection-translation__locate:focus-visible {
      text-decoration: underline;
      outline: none;
    }

    .lexi-selection-translation__collapsed {
      all: initial;
      box-sizing: border-box;
      display: none;
      align-items: center;
      gap: 0.4em;
      max-width: 100%;
      padding: 0.24em 0.65em;
      color: var(--lexi-accent-ink);
      cursor: pointer;
      font: 12px/1.45 var(--lexi-font-sans);
      user-select: none;
    }

    .lexi-selection-translation[data-lexi-collapsed="true"] .lexi-selection-translation__collapsed {
      display: inline-flex;
      animation: lexi-capsule-content-enter 180ms ease-out both;
    }

    .lexi-selection-translation__collapsed-icon {
      all: initial;
      color: var(--lexi-accent);
      font: 13px/1 var(--lexi-font-sans);
    }

    .lexi-selection-translation__collapsed-text {
      all: initial;
      min-width: 0;
      overflow: hidden;
      color: var(--lexi-accent-ink);
      font: 12px/1.45 var(--lexi-font-sans);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @keyframes lexi-toast-enter {
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    @keyframes lexi-toast-exit {
      from {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      to {
        opacity: 0;
        transform: translateX(-50%) translateY(6px);
      }
    }

    @keyframes lexi-text-reveal {
      from {
        opacity: 0.42;
        filter: blur(3px);
        transform: translateY(2px);
      }
      to {
        opacity: 1;
        filter: blur(0);
        transform: translateY(0);
      }
    }

    @keyframes lexi-card-enter {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes lexi-capsule-content-enter {
      from {
        opacity: 0;
        transform: translateY(1px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes lexi-char-reveal {
      from {
        opacity: 0;
        filter: blur(3px);
        transform: translateX(4px);
      }
      to {
        opacity: 1;
        filter: blur(0);
        transform: translateX(0);
      }
    }

    @keyframes lexi-shimmer-surface {
      from {
        background-position-x: 110%;
      }
      to {
        background-position-x: -110%;
      }
    }

    @keyframes lexi-shimmer-sweep {
      to {
        transform: translateX(120%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .lexi-selection-translation__text[data-lexi-revealing="true"],
      .lexi-selection-translation__chunk[data-lexi-new="true"],
      .lexi-selection-translation__char[data-lexi-new="true"],
      .lexi-selection-translation__text[data-lexi-loading="true"],
      .lexi-selection-translation[data-lexi-loading="true"],
      .lexi-selection-translation[data-lexi-loading="true"]::after,
      .lexi-selection-translation[data-lexi-collapsed="true"] .lexi-selection-translation__collapsed,
      .lexi-selection-translation {
        animation: none;
      }
    }

    /* Translations read as quiet footnotes to the original paragraph, not as
       AI task cards: one soft tint, no accent bars, no looping animation.
       Scheduling priority (viewport/near/prefetch) stays invisible on purpose. */
    .lexi-page-translation {
      all: initial;
      box-sizing: border-box;
      display: block;
      margin: 0.55em 0;
      border-radius: 8px;
      background: var(--lexi-accent-soft);
      padding: 0.55em 0.7em;
      color: var(--lexi-ink);
      /* A footnote to the source paragraph: same face, one notch down in size. */
      font-family: var(--lexi-card-font-family);
      font-size: calc(var(--lexi-card-font-size) * 0.92);
      line-height: 1.6;
      white-space: pre-wrap;
      overflow: hidden;
      overflow-wrap: anywhere;
      animation: lexi-page-translation-enter 180ms ease-out both;
    }

    .lexi-page-translation[data-lexi-loading="true"] {
      color: var(--lexi-ink-3);
      transition: opacity 180ms ease;
      opacity: 0.75;
    }

    @keyframes lexi-page-translation-enter {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
      .lexi-page-translation,
      .lexi-page-translation[data-lexi-loading="true"] {
        animation: none;
        transition: none;
      }
    }

    /* Live chat translations sit under the message they belong to: a quiet tinted
       footnote that inherits the chat's own type. No card, no shadow, no motion —
       chat streams messages continuously and every animation there is noise. */
    .lexi-chat-translation {
      all: initial;
      display: block;
      margin: 2px 0 4px;
      border-radius: 6px;
      background: var(--lexi-accent-soft);
      padding: 3px 8px;
      color: var(--lexi-ink);
      font: inherit;
      font-size: 0.94em;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .lexi-media-highlight {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483646;
      overflow: visible;
      border: 2px solid rgba(25, 118, 255, 0.9);
      border-radius: var(--lexi-media-radius, 16px);
      box-shadow: 0 0 0 4px rgba(25, 118, 255, 0.14), 0 16px 40px -8px rgba(13, 13, 13, 0.2);
      pointer-events: none;
      animation: lexi-card-enter 160ms ease-out both;
    }

    .lexi-media-highlight::after {
      content: "Lexi";
      position: absolute;
      right: 8px;
      top: 8px;
      z-index: 1;
      border-radius: 999px;
      background: rgba(13, 13, 13, 0.92);
      box-shadow: 0 8px 20px rgba(13, 13, 13, 0.22);
      color: #fff;
      font: 700 11px/1 var(--lexi-font-sans);
      letter-spacing: .02em;
      padding: 5px 8px;
    }

    @media (prefers-reduced-motion: reduce) {
      .lexi-media-highlight {
        animation: none;
      }
    }

    .lexi-media-toolbar {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483647;
      display: grid;
      gap: 10px;
      width: min(420px, calc(100vw - 24px));
      border: 1px solid var(--lexi-line);
      border-radius: 16px;
      background: var(--lexi-glass-bg);
      box-shadow: var(--lexi-glass-shadow);
      backdrop-filter: var(--lexi-glass-blur);
      -webkit-backdrop-filter: var(--lexi-glass-blur);
      color: var(--lexi-ink);
      padding: 12px;
      font: 13px/1.45 var(--lexi-font-sans);
      animation: lexi-card-enter 160ms ease-out both;
    }

    @supports not (backdrop-filter: blur(4px)) {
      .lexi-media-toolbar {
        background: rgba(255, 255, 255, 0.97);
      }
    }

    .lexi-media-toolbar * {
      box-sizing: border-box;
      font-family: var(--lexi-font-sans);
    }

    .lexi-media-toolbar__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .lexi-media-toolbar__title {
      min-width: 0;
      overflow: hidden;
      color: var(--lexi-ink);
      font-size: 13px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lexi-media-toolbar__close {
      border: 0;
      background: transparent;
      color: var(--lexi-ink-3);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 0 3px;
    }

    .lexi-media-toolbar__meta {
      overflow: hidden;
      color: var(--lexi-ink-3);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lexi-media-toolbar__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .lexi-media-toolbar__button {
      border: 1px solid var(--lexi-line-strong);
      border-radius: 999px;
      background: var(--lexi-bg);
      color: var(--lexi-ink);
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      padding: 7px 12px;
    }

    .lexi-media-toolbar__button:hover {
      border-color: var(--lexi-ink-3);
    }

    .lexi-media-toolbar__button:first-child {
      border-color: transparent;
      background: var(--lexi-ink);
      color: #ffffff;
    }

    .lexi-media-toolbar__button:first-child:hover {
      background: #2b2b2b;
    }

    .lexi-media-toolbar__answer {
      max-height: 260px;
      overflow: auto;
      border: 1px solid var(--lexi-line);
      border-radius: 12px;
      background: var(--lexi-bg-subtle);
      padding: 11px 12px;
      color: var(--lexi-ink-2);
      font-size: 12px;
      line-height: 1.68;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .lexi-dialog {
      /* ChatGPT-style surface: flat, quiet, generous radius, one strong shadow. */
      --ld-bg: #ffffff;
      --ld-text: #0d0d0d;
      --ld-muted: #8f8f8f;
      --ld-faint: #b4b4b4;
      --ld-border: rgba(13, 13, 13, 0.1);
      --ld-hover: rgba(13, 13, 13, 0.05);
      --ld-bubble: #f4f4f4;
      --ld-code-bg: #f9f9f9;
      --ld-code-border: rgba(13, 13, 13, 0.08);
      --ld-link: #1976ff;
      --ld-composer-bg: #ffffff;
      --ld-composer-border: rgba(13, 13, 13, 0.16);
      --ld-composer-focus: rgba(13, 13, 13, 0.42);
      --ld-send-bg: #0d0d0d;
      --ld-send-fg: #ffffff;
      --ld-send-disabled: #e3e3e3;
      --ld-send-disabled-fg: #a6a6a6;
      --ld-chip-bg: #ffffff;
      --ld-chip-border: rgba(13, 13, 13, 0.12);
      --ld-shadow: 0 24px 70px rgba(0, 0, 0, 0.16), 0 4px 14px rgba(0, 0, 0, 0.06);
      all: initial;
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      width: min(680px, calc(100vw - 32px));
      max-height: min(72vh, 640px);
      border: 1px solid var(--ld-border);
      border-radius: 18px;
      background: var(--ld-bg);
      box-shadow: var(--ld-shadow);
      color: var(--ld-text);
      color-scheme: light;
      font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif;
      overflow: hidden;
      animation: lexi-dialog-enter 180ms cubic-bezier(0.2, 0.9, 0.2, 1) both;
    }

    .lexi-dialog * {
      box-sizing: border-box;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif;
    }

    .lexi-dialog__head {
      display: flex;
      align-items: center;
      flex: none;
      gap: 8px;
      border-bottom: 1px solid var(--ld-border);
      padding: 10px 14px;
      cursor: grab;
      /* The header is the drag handle, so a drag must not select the title text. */
      user-select: none;
      touch-action: none;
    }

    .lexi-dialog__head button { cursor: pointer; }

    .lexi-dialog[data-lexi-dialog-dragging="true"] .lexi-dialog__head { cursor: grabbing; }

    .lexi-dialog[data-lexi-dialog-dragging="true"],
    .lexi-dialog[data-lexi-dialog-resizing="true"] {
      user-select: none;
      animation: none;
    }

    .lexi-dialog__resizer {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 18px;
      height: 18px;
      cursor: nwse-resize;
      touch-action: none;
    }

    .lexi-dialog__resizer::after {
      content: "";
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 7px;
      height: 7px;
      border-right: 1.5px solid var(--ld-faint);
      border-bottom: 1.5px solid var(--ld-faint);
      border-bottom-right-radius: 2px;
    }

    .lexi-dialog[data-lexi-collapsed="true"] > .lexi-dialog__resizer { display: none; }

    .lexi-dialog__title {
      flex: none;
      color: var(--ld-text);
      font-size: 14px;
      font-weight: 650;
      letter-spacing: 0.01em;
    }

    .lexi-dialog__subtitle {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      color: var(--ld-muted);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lexi-dialog__close,
    .lexi-dialog__collapse-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      flex: none;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--ld-muted);
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      padding: 0;
    }

    .lexi-dialog__close:hover,
    .lexi-dialog__collapse-toggle:hover {
      background: var(--ld-hover);
      color: var(--ld-text);
      opacity: 1;
    }

    .lexi-dialog__body {
      display: flex;
      min-height: 0;
      flex: 1;
      flex-direction: column;
    }

    .lexi-dialog__messages {
      display: flex;
      min-height: 96px;
      flex: 1;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 16px 18px 8px;
      scroll-behavior: smooth;
      scrollbar-width: thin;
      scrollbar-color: rgba(127, 127, 127, 0.35) transparent;
    }

    .lexi-dialog__messages::-webkit-scrollbar { width: 6px; }
    .lexi-dialog__messages::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(127, 127, 127, 0.35); }
    .lexi-dialog__messages::-webkit-scrollbar-track { background: transparent; }

    .lexi-dialog__msg {
      display: flex;
      flex-direction: column;
      animation: lexi-dialog-msg-in 180ms ease-out both;
    }

    .lexi-dialog__msg--user { align-items: flex-end; }
    .lexi-dialog__msg--assistant { align-items: stretch; }

    /* User turns: quiet gray bubble on the right, like ChatGPT. */
    .lexi-dialog__bubble {
      max-width: 85%;
      border-radius: 18px;
      background: var(--ld-bubble);
      padding: 9px 14px;
      color: var(--ld-text);
      font-size: 14px;
      line-height: 1.6;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    /* Assistant turns: no bubble, plain text on the surface. */
    .lexi-dialog__md {
      color: var(--ld-text);
      font-size: 14px;
      line-height: 1.65;
      overflow-wrap: anywhere;
    }

    .lexi-dialog__note {
      align-self: center;
      max-width: 88%;
      color: var(--ld-faint);
      font-size: 12px;
      line-height: 1.5;
      text-align: center;
    }

    .lexi-dialog__md p { margin: 0 0 10px; }
    .lexi-dialog__md p:last-child, .lexi-dialog__bubble p { margin: 0; }
    .lexi-dialog__md ul, .lexi-dialog__md ol { margin: 0 0 10px; padding-left: 22px; }
    .lexi-dialog__md li { margin: 3px 0; }
    .lexi-dialog__md blockquote { margin: 0 0 10px; border-left: 3px solid var(--ld-border); padding: 2px 0 2px 12px; color: var(--ld-muted); }
    .lexi-dialog__md a { color: var(--ld-link); text-decoration: underline; text-underline-offset: 2px; }
    .lexi-dialog__md code, .lexi-dialog__bubble code {
      border: 1px solid var(--ld-code-border);
      border-radius: 6px;
      background: var(--ld-code-bg);
      padding: 1px 5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12.5px;
    }
    .lexi-dialog__md pre {
      margin: 0 0 10px;
      border: 1px solid var(--ld-code-border);
      border-radius: 10px;
      background: var(--ld-code-bg);
      padding: 12px 14px;
      overflow-x: auto;
    }
    .lexi-dialog__md pre code { border: 0; background: transparent; padding: 0; font-size: 12.5px; line-height: 1.55; }

    /* Streaming indicator: ChatGPT's pulsing dot at the end of the draft. */
    .lexi-dialog__cursor {
      display: inline-block;
      width: 9px;
      height: 9px;
      margin-left: 3px;
      border-radius: 50%;
      background: var(--ld-text);
      vertical-align: baseline;
      animation: lexi-dialog-cursor 900ms ease-in-out infinite;
    }

    .lexi-dialog__sources {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }

    .lexi-dialog__source-chip {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      gap: 5px;
      border: 1px solid var(--ld-chip-border);
      border-radius: 999px;
      background: var(--ld-chip-bg);
      color: var(--ld-muted);
      cursor: pointer;
      font-size: 11.5px;
      line-height: 1;
      padding: 5px 10px;
    }

    .lexi-dialog__source-chip:hover { background: var(--ld-hover); color: var(--ld-text); }
    .lexi-dialog__source-chip span { overflow: hidden; max-width: 200px; text-overflow: ellipsis; white-space: nowrap; }

    .lexi-dialog__composer { flex: none; padding: 8px 14px 12px; }

    .lexi-dialog__suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 2px 8px;
    }

    .lexi-dialog__suggestion {
      border: 1px solid var(--ld-chip-border);
      border-radius: 999px;
      background: var(--ld-chip-bg);
      color: var(--ld-muted);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      line-height: 1.4;
      padding: 5px 11px;
    }

    .lexi-dialog__suggestion:hover {
      background: var(--ld-hover);
      color: var(--ld-text);
    }

    .lexi-dialog__context {
      overflow: hidden;
      margin: 0 4px 6px;
      color: var(--ld-faint);
      font-size: 11.5px;
      line-height: 1.5;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* The composer: one rounded field with the send control inside, ChatGPT-style. */
    .lexi-dialog__form {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      border: 1px solid var(--ld-composer-border);
      border-radius: 24px;
      background: var(--ld-composer-bg);
      padding: 8px 8px 8px 16px;
      transition: border-color 120ms ease;
    }

    .lexi-dialog__form:focus-within { border-color: var(--ld-composer-focus); }

    .lexi-dialog__input {
      display: block;
      min-width: 0;
      flex: 1;
      min-height: 24px;
      max-height: 160px;
      resize: none;
      border: 0;
      background: transparent;
      padding: 3px 0;
      color: var(--ld-text);
      font-size: 14px;
      line-height: 1.55;
      outline: none;
      overflow-y: auto;
      scrollbar-width: thin;
    }

    .lexi-dialog__input::placeholder { color: var(--ld-faint); }

    .lexi-dialog__send {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      flex: none;
      border: 0;
      border-radius: 50%;
      background: var(--ld-send-bg);
      color: var(--ld-send-fg);
      cursor: pointer;
      padding: 0;
      transition: opacity 120ms ease, transform 120ms ease;
    }

    .lexi-dialog__send:hover { opacity: 0.85; }
    .lexi-dialog__send:active { transform: scale(0.94); }
    .lexi-dialog__send[data-lexi-idle="true"] { background: var(--ld-send-disabled); color: var(--ld-send-disabled-fg); cursor: default; }
    .lexi-dialog__send svg { display: block; }

    .lexi-dialog__hint {
      margin: 7px 4px 0;
      color: var(--ld-faint);
      font-size: 11px;
      text-align: center;
    }

    @keyframes lexi-dialog-enter {
      from { opacity: 0; transform: translateY(6px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes lexi-dialog-msg-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes lexi-dialog-cursor {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.35; transform: scale(0.82); }
    }

    @media (prefers-color-scheme: dark) {
      .lexi-dialog {
        --ld-bg: #212121;
        --ld-text: #ececec;
        --ld-muted: #9b9b9b;
        --ld-faint: #7c7c7c;
        --ld-border: rgba(255, 255, 255, 0.09);
        --ld-hover: rgba(255, 255, 255, 0.08);
        --ld-bubble: #303030;
        --ld-code-bg: #171717;
        --ld-code-border: rgba(255, 255, 255, 0.08);
        --ld-link: #6fa8ff;
        --ld-composer-bg: #2f2f2f;
        --ld-composer-border: rgba(255, 255, 255, 0.12);
        --ld-composer-focus: rgba(255, 255, 255, 0.36);
        --ld-send-bg: #ececec;
        --ld-send-fg: #0d0d0d;
        --ld-send-disabled: #3a3a3a;
        --ld-send-disabled-fg: #737373;
        --ld-chip-bg: #2a2a2a;
        --ld-chip-border: rgba(255, 255, 255, 0.12);
        --ld-shadow: 0 24px 70px rgba(0, 0, 0, 0.55), 0 4px 14px rgba(0, 0, 0, 0.3);
        color-scheme: dark;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .lexi-dialog, .lexi-dialog__msg { animation: none; }
      .lexi-dialog__cursor { animation: none; opacity: 0.6; }
    }

    ${collapsibleStyles('lexi-dialog')}
    ${collapsibleStyles('lexi-media-toolbar')}

    ${customCss}
  `
}

function parseCssColor(value: string): [number, number, number, number] | undefined {
  const match = value.match(/rgba?\(([^)]+)\)/)
  if (!match)
    return undefined

  const parts = match[1].split(',').map(part => Number.parseFloat(part.trim()))
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN))
    return undefined

  return [parts[0], parts[1], parts[2], Number.isNaN(parts[3]) ? 1 : parts[3] ?? 1]
}

function prefersDarkColorScheme() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Injected UI follows the page's own theme first, and the system theme when the page has
 * no opinion.
 *
 * Plenty of pages paint their background on a wrapper instead of `html`/`body`, so the
 * luminance walk finds nothing but transparency; defaulting those to light put a white
 * card on a black page. `color-scheme` is the page's own declaration and beats the OS
 * preference, but only when it names a single scheme — `light dark` means "follow the OS".
 */
function detectPageTheme(): 'light' | 'dark' {
  let element: Element | null = document.body ?? document.documentElement
  while (element) {
    const color = parseCssColor(getComputedStyle(element).backgroundColor)
    if (color && color[3] > 0.02) {
      const [r, g, b] = color
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      return luminance < 0.45 ? 'dark' : 'light'
    }

    element = element.parentElement
  }

  const declared = getComputedStyle(document.documentElement).colorScheme ?? ''
  if (declared.includes('dark') && !declared.includes('light'))
    return 'dark'
  if (declared.includes('light') && !declared.includes('dark'))
    return 'light'

  return prefersDarkColorScheme() ? 'dark' : 'light'
}

/**
 * Injected blocks sit inside the page's own prose, so they have to be set in the page's
 * type. A fixed 14px stack read as a foreign widget on any site whose body copy is not
 * 14px — which is most of them. Clamped so a hero heading or a footnote cannot drag the
 * card to an unreadable size.
 */
export function applyAnchorTypography(element: HTMLElement, anchor?: Element | null) {
  const source = anchor ?? document.body
  if (!source)
    return

  const style = getComputedStyle(source)
  const size = Number.parseFloat(style.fontSize)
  if (Number.isFinite(size) && size > 0)
    element.style.setProperty('--lexi-card-font-size', `${Math.min(20, Math.max(13, size))}px`)
  if (style.fontFamily)
    element.style.setProperty('--lexi-card-font-family', style.fontFamily)
}

function refreshPageTheme() {
  const theme = detectPageTheme()
  if (document.documentElement.dataset.lexiTheme !== theme)
    document.documentElement.dataset.lexiTheme = theme
}

let systemColorSchemeWatched = false

/** An OS theme flip has to reach already-open cards, not just the next one. */
function watchSystemColorScheme() {
  if (systemColorSchemeWatched || typeof window.matchMedia !== 'function')
    return

  systemColorSchemeWatched = true
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshPageTheme)
}

export function ensurePageStyles(customCss = '') {
  refreshPageTheme()
  watchSystemColorScheme()

  const content = getPageStyleContent(customCss)
  const current = document.getElementById('lexi-page-style')
  if (current) {
    if (current.textContent !== content)
      current.textContent = content
    return
  }

  const style = document.createElement('style')
  style.id = 'lexi-page-style'
  style.textContent = content
  document.documentElement.appendChild(style)
}
