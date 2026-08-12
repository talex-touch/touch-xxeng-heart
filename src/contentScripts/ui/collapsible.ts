import { canAnimate, prefersReducedMotion } from './digestCard'

/**
 * One collapse behaviour for every Lexi panel.
 *
 * Each surface used to hand-roll its own: the digests toggled a `--collapsed` class via
 * click delegation, the selection card flipped a dataset flag, and the dialog and media
 * toolbar had no collapse at all. They now share this state machine and stylesheet.
 */
export interface CollapsibleOptions {
  /** Block class, e.g. `lexi-dialog`. Modifier and part classes derive from it. */
  block: string
  /** Text shown on the collapsed pill. */
  label: string
  /** Secondary text on the collapsed pill, e.g. the repo or topic name. */
  summary?: string
  /** Start collapsed. */
  collapsed?: boolean
  /** Notified after every state change, e.g. to reposition a floating panel. */
  onToggle?: (collapsed: boolean) => void
}

export interface CollapsibleHandle {
  /** The pill shown in place of the panel body when collapsed. */
  pill: HTMLButtonElement
  /** The button that collapses the panel, for placing in a header. */
  toggle: HTMLButtonElement
  readonly collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  setSummary: (summary: string) => void
  destroy: () => void
}

export const collapsedAttribute = 'data-lexi-collapsed'

/**
 * Shared stylesheet for the collapse affordance, parameterised by block class so each
 * surface keeps its own palette while the geometry and motion stay identical.
 */
export function collapsibleStyles(block: string) {
  return `
    .${block}__collapse-toggle { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: none; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 14px; line-height: 1; opacity: .66; padding: 0; }
    .${block}__collapse-toggle:hover { opacity: 1; background: rgba(127, 127, 127, .16); }
    .${block}__collapsed-pill { display: none; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; padding: 0; }
    .${block}__collapsed-pill span { display: block; font-size: 11px; font-weight: 700; opacity: .8; }
    .${block}__collapsed-pill strong { display: block; overflow: hidden; margin-top: 1px; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; opacity: .72; }
    .${block}[${collapsedAttribute}="true"] > .${block}__collapsed-pill { display: flex; }
    .${block}[${collapsedAttribute}="true"] > .${block}__body,
    .${block}[${collapsedAttribute}="true"] > .${block}__head,
    .${block}[${collapsedAttribute}="true"] > .${block}__content { display: none; }
    .${block}[${collapsedAttribute}="true"] { width: auto; min-width: 148px; max-width: 232px; min-height: 0; max-height: none; overflow: hidden; padding: 9px 12px; border-radius: 999px; }
    @media (prefers-reduced-motion: no-preference) {
      .${block}__collapsed-pill { animation: lexi-collapse-pill-in 220ms cubic-bezier(.2,.9,.2,1) both; }
    }
    @keyframes lexi-collapse-pill-in { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: scale(1); } }
  `
}

function createIconButton(className: string, label: string, glyph: string) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  button.title = label
  button.textContent = glyph
  return button
}

/**
 * Wires collapse/expand onto `panel`. The caller owns layout; this owns state,
 * the two affordances, ARIA wiring and the geometry morph.
 */
export function createCollapsible(panel: HTMLElement, options: CollapsibleOptions): CollapsibleHandle {
  const { block } = options
  let collapsed = options.collapsed ?? false

  const pill = document.createElement('button')
  pill.type = 'button'
  pill.className = `${block}__collapsed-pill`
  pill.setAttribute('aria-label', `展开${options.label}`)
  const pillLabel = document.createElement('span')
  pillLabel.textContent = options.label
  const pillSummary = document.createElement('strong')
  pillSummary.textContent = options.summary ?? ''
  pill.append(pillLabel, pillSummary)

  const toggle = createIconButton(`${block}__collapse-toggle`, `收起${options.label}`, '−')

  const apply = (next: boolean, animate: boolean) => {
    if (collapsed === next)
      return

    const from = animate ? panel.getBoundingClientRect() : undefined
    collapsed = next
    panel.setAttribute(collapsedAttribute, String(collapsed))
    pill.setAttribute('aria-expanded', String(!collapsed))
    toggle.setAttribute('aria-expanded', String(!collapsed))

    // The owner lays out first: a panel that restores a user-set size on expand would
    // otherwise be measured at its collapsed width and morph toward the wrong geometry.
    options.onToggle?.(collapsed)

    if (from && !prefersReducedMotion() && canAnimate(panel)) {
      const to = panel.getBoundingClientRect()
      if (from.height && to.height) {
        panel.animate([
          { width: `${from.width}px`, height: `${from.height}px`, opacity: 0.7 },
          { width: `${to.width}px`, height: `${to.height}px`, opacity: 1 },
        ], { duration: 220, easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)' })
      }
    }
  }

  const onPillClick = () => apply(false, true)
  const onToggleClick = () => apply(true, true)
  pill.addEventListener('click', onPillClick)
  toggle.addEventListener('click', onToggleClick)

  panel.setAttribute(collapsedAttribute, String(collapsed))
  pill.setAttribute('aria-expanded', String(!collapsed))
  toggle.setAttribute('aria-expanded', String(!collapsed))

  return {
    pill,
    toggle,
    get collapsed() {
      return collapsed
    },
    setCollapsed(next: boolean) {
      apply(next, true)
    },
    setSummary(summary: string) {
      pillSummary.textContent = summary
    },
    destroy() {
      pill.removeEventListener('click', onPillClick)
      toggle.removeEventListener('click', onToggleClick)
    },
  }
}
