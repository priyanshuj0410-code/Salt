# Salt — Design System (`design.md`)

**Version:** 0.2
**Companion to:** `salt-design-system.html` (visual reference)
**Audience:** Engineers and LLM coding agents building Salt screens
**Rule of thumb:** If you're about to write a hardcoded color, spacing value, or font size — stop. It's a token. Use the token.

---

## 0. How to use this file

This is the contract. Before building any screen or component:

1. Read the relevant section here.
2. Use tokens, never raw values.
3. Compose from documented primitives and patterns; don't invent new ones.
4. If you genuinely need something not in the system, propose it via PR with rationale — don't quietly add it.

The visual reference (`salt-design-system.html`) shows what each thing looks like. This file tells you how to build it.

**Stack assumptions:** React 18 + TypeScript, Tailwind CSS, shadcn/ui primitives, CSS custom properties for tokens. Examples use Tailwind utility classes mapped to tokens via the config in §2.

---

## 1. Principles (in priority order)

When two principles conflict, the earlier one wins.

1. **Speed before delight.** Operated by cashiers on 12-hour shifts. Invest visual budget in information density and clarity of state, not motion or ornament.
2. **Keyboard is the primary input.** Every mouse action has a keyboard equivalent with a visible shortcut hint. Focus states are first-class.
3. **Trust through precision.** Financial software in a regulated category. Right-aligned tabular numbers. Explicit states (saved / saving / failed). Visible audit cues.
4. **Quiet by default, loud only when needed.** Near-white surfaces. Color reserved for state. No decoration. If everything is highlighted, nothing is.
5. **Two densities, one system.** Counter mode (compact) and owner mode (default) share all tokens and primitives. Only spacing and row height change. Never two design languages.
6. **Indian-first, never Indian-only.** `en-IN` currency formatting (₹1,00,000). Bilingual where it matters. No heavy cultural ornamentation.

---

## 2. Tokens

### 2.1 CSS custom properties (source of truth)

Drop this into your global stylesheet (`globals.css` or equivalent). Every value in the product traces back here.

```css
:root {
  /* ---- Neutrals ---- */
  --color-background: #ffffff;
  --color-surface: #fafafa;          /* zinc-50 */
  --color-surface-2: #f4f4f5;        /* zinc-100 */
  --color-border: #e4e4e7;           /* zinc-200 */
  --color-border-strong: #d4d4d8;    /* zinc-300 */
  --color-control: #898992;          /* border of inputs and outlined controls; 3:1+ on background, surface, surface-2. Dark: #74747d */
  --color-divider: #f4f4f5;          /* zinc-100 */

  --color-text-primary: #18181b;     /* zinc-900 */
  --color-text-secondary: #52525b;   /* zinc-600 */
  --color-text-tertiary: #71717a;    /* zinc-500 */
  --color-text-disabled: #a1a1aa;    /* zinc-400 */
  --color-text-inverse: #fafafa;

  /* ---- Action ---- */
  --color-action-primary: #18181b;
  --color-action-primary-hover: #27272a;
  --color-action-primary-text: #ffffff;
  --color-action-secondary: #f4f4f5;
  --color-action-secondary-hover: #e4e4e7;
  --color-action-secondary-text: #18181b;

  /* ---- Semantic (on light) ---- */
  --color-success: #166534;          --color-success-bg: #f0fdf4;  --color-success-border: #bbf7d0;
  --color-warning: #b45309;          --color-warning-bg: #fffbeb;  --color-warning-border: #fde68a;
  --color-danger: #b91c1c;           --color-danger-bg: #fef2f2;   --color-danger-border: #fecaca;
  --color-info: #1e40af;             --color-info-bg: #eff6ff;     --color-info-border: #bfdbfe;

  /* ---- Semantic (on dark) — for fills/dots/borders on dark surfaces ---- */
  --color-success-on-dark: #4ade80;  /* emerald-400 */
  --color-warning-on-dark: #fbbf24;  /* amber-400 */
  --color-danger-on-dark: #f87171;   /* red-400 */

  /* ---- Focus ---- */
  --color-focus-ring: #18181b;       /* = action-primary, solid; flips to #fafafa in dark. Drawn as a 2px outline, 2px offset */

  /* ---- Spacing (4px base) ---- */
  --space-1: 0.25rem;  --space-2: 0.5rem;   --space-3: 0.75rem;  --space-4: 1rem;
  --space-5: 1.25rem;  --space-6: 1.5rem;   --space-8: 2rem;     --space-12: 3rem;

  /* ---- Type ---- */
  --font-sans: "Geist", "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
  --font-display: "Fraunces", Georgia, serif;  /* wordmark/editorial only — never product UI */

  --text-xs: 0.6875rem;   /* 11px */
  --text-sm: 0.8125rem;   /* 13px */
  --text-base: 0.9375rem; /* 15px */
  --text-lg: 1.0625rem;   /* 17px */
  --text-xl: 1.375rem;    /* 22px */
  --text-2xl: 1.75rem;    /* 28px */

  --leading-tight: 1.2;   --leading-normal: 1.45;  --leading-relaxed: 1.6;
  --tracking-tight: -0.015em;  --tracking-normal: 0;  --tracking-wide: 0.05em;
  --font-regular: 400;  --font-medium: 500;  --font-semibold: 600;  --font-bold: 700;

  /* ---- Radii ---- */
  --radius-sm: 0.25rem;  --radius-md: 0.375rem;  --radius-lg: 0.5rem;
  --radius-xl: 0.75rem;  --radius-full: 9999px;

  /* ---- Shadows ---- */
  --shadow-xs: 0 1px 0 0 rgba(0,0,0,0.04);
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05);
  --shadow-md: 0 4px 12px -2px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04);
  --shadow-lg: 0 12px 32px -8px rgba(0,0,0,0.12), 0 4px 8px -2px rgba(0,0,0,0.06);
  --shadow-modal: 0 24px 48px -12px rgba(0,0,0,0.18);

  /* ---- Motion ---- */
  --duration-instant: 50ms;  --duration-fast: 120ms;  --duration-medium: 200ms;  --duration-slow: 320ms;
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);

  /* ---- Z-index ---- */
  --z-base: 0;  --z-sticky: 10;  --z-dropdown: 20;  --z-overlay: 30;  --z-modal: 40;  --z-toast: 50;

  /* ---- Density ---- */
  --row-height-compact: 36px;   --row-height-default: 44px;
  --input-height-compact: 32px; --input-height-default: 36px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 2.2 Tailwind config mapping

Wire the tokens into Tailwind so utility classes resolve to tokens. `tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

export default {
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        surface: { DEFAULT: "var(--color-surface)", 2: "var(--color-surface-2)" },
        border: { DEFAULT: "var(--color-border)", strong: "var(--color-border-strong)", control: "var(--color-control)" },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          tertiary: "var(--color-text-tertiary)",
          disabled: "var(--color-text-disabled)",
          inverse: "var(--color-text-inverse)",
        },
        success: { DEFAULT: "var(--color-success)", bg: "var(--color-success-bg)", border: "var(--color-success-border)", dark: "var(--color-success-on-dark)" },
        warning: { DEFAULT: "var(--color-warning)", bg: "var(--color-warning-bg)", border: "var(--color-warning-border)", dark: "var(--color-warning-on-dark)" },
        danger:  { DEFAULT: "var(--color-danger)",  bg: "var(--color-danger-bg)",  border: "var(--color-danger-border)",  dark: "var(--color-danger-on-dark)" },
        info:    { DEFAULT: "var(--color-info)",    bg: "var(--color-info-bg)",    border: "var(--color-info-border)" },
      },
      fontFamily: {
        sans: ["Geist", "Inter", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "monospace"],
        display: ["Fraunces", "Georgia", "serif"],
      },
      fontSize: {
        xs: ["0.6875rem", { lineHeight: "1.4" }],
        sm: ["0.8125rem", { lineHeight: "1.45" }],
        base: ["0.9375rem", { lineHeight: "1.45" }],
        lg: ["1.0625rem", { lineHeight: "1.3" }],
        xl: ["1.375rem", { lineHeight: "1.2" }],
        "2xl": ["1.75rem", { lineHeight: "1.1" }],
      },
      borderRadius: { sm: "0.25rem", md: "0.375rem", lg: "0.5rem", xl: "0.75rem" },
      boxShadow: {
        xs: "var(--shadow-xs)", sm: "var(--shadow-sm)", md: "var(--shadow-md)",
        lg: "var(--shadow-lg)", modal: "var(--shadow-modal)",
      },
      transitionTimingFunction: { out: "var(--ease-out)", "in-out": "var(--ease-in-out)" },
    },
  },
} satisfies Config;
```

After this, write `bg-surface text-text-secondary border-border` instead of `bg-zinc-50 text-zinc-600 border-zinc-200`. The token names carry intent; the zinc numbers don't.

### 2.3 Token usage rules

| Token group | Use for | Never use for |
|---|---|---|
| `text-primary` | Headings, key values, primary labels | Body paragraphs (too heavy at length) |
| `text-secondary` | Body text, secondary labels | Captions (use tertiary) |
| `text-tertiary` | Captions, hints, table headers | Anything on `surface-2` (contrast fails) |
| `surface` | Secondary panels, table headers, hover | Primary content background |
| `surface-2` | Chips, kbd, hover-pressed | Large fills (too heavy) |
| semantic (on-light) | Text/border/tint on white | Solid fills, anything on dark surfaces |
| semantic (on-dark) | Dots/borders/fills on dark surfaces | Anything on white (too light, fails contrast) |

**The cardinal sin:** using an on-light semantic color (e.g. `--color-warning`, a dark amber) as a background fill. It renders muddy. Use the on-dark shade for fills on dark surfaces, or the `-bg`/`-border` tint pair on light surfaces.

---

## 3. Typography rules

- **Geist** for all product UI. **Geist Mono** for codes, batch numbers, invoice IDs, anything tabular-by-meaning. **Fraunces** for the wordmark only — never inside the product.
- Six sizes (xs → 2xl). No improvised sizes (`text-[13px]` is banned; it's `text-sm`).
- **Tabular numerals everywhere money/quantity/percent/count lives:** add `tabular-nums` (Tailwind) or `font-variant-numeric: tabular-nums`.
- **Currency is always `en-IN`:**

```ts
export const formatINR = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 2,
  }).format(n);
// formatINR(1248750) → "₹12,48,750.00"
```

- Uppercase labels: `text-xs uppercase tracking-wide font-semibold text-text-tertiary`.

---

## 4. Density

Salt has two density modes. Set `data-density` on the screen container; components read it.

```tsx
<div data-density="compact"> {/* counter / cashier screens */}
<div data-density="default"> {/* owner / back-office screens */}
```

| | Compact (counter) | Default (owner) |
|---|---|---|
| Row height | 36px | 44px |
| Input height | 32px | 36px |
| Body text | `text-sm` (13px) | `text-base` (15px) |
| Card padding | `space-3` / `space-4` | `space-5` |
| Items visible in viewport | ~22 | ~16 |

Rule: same tokens, same primitives, both modes. If you find yourself building a separate component for compact mode, stop — parametrize the existing one.

---

## 5. Primitives

Each primitive lists its variants, sizes, and the rule that governs it. Build these as shadcn-style components in `components/ui/`.

### 5.1 Button

**Variants:** `primary` | `secondary` | `ghost` | `danger`
**Sizes:** `sm` (28px) | `md` (34px) | `lg` (40px)

```tsx
<Button variant="primary" size="md">Save & Print <Kbd>F12</Kbd></Button>
<Button variant="secondary" size="sm">Cancel</Button>
<Button variant="ghost">Skip for now</Button>
<Button variant="danger">Delete bill</Button>
```

Rules:
- One `primary` per surface (the main action). Five primaries = no primary.
- Icons ≤ 14px. Left of label for actions, right for navigation.
- Focus: the global `:focus-visible` outline, 2px solid `--color-focus-ring` with a 2px offset. No per-component ring.

### 5.2 Input

**Heights:** default 36px, compact 32px (matches density mode).

```tsx
<Input placeholder="Customer name" />
<Input className="h-8" placeholder="Phone" /> {/* compact */}
```

Rules:
- Border: `--color-control` (3:1+), never `--color-border`. Focus: border → `action-primary`, plus the global 2px solid outline. 120ms color crossfade, no glow.
- Inline-editable table cells (qty, discount): transparent background, bottom-border only (`--color-control`), darkens on focus. No box.
- Placeholders use `text-disabled`.

### 5.3 Badge

**Variants:** `neutral` | `success` | `warning` | `danger` | `strong`

```tsx
<Badge variant="success">In stock</Badge>
<Badge variant="danger">Out of stock</Badge>
<Badge variant="danger">Sch H1</Badge>
<Badge variant="strong">DOCTOR</Badge>
```

Rules:
- Subtle variants use `-bg` + foreground color. `strong` uses solid `text-primary` background + inverse text.
- Tiny: 10px text, 2px×7px padding, `radius-sm`.
- Never use a badge color to mean a category. Status only.

### 5.4 Kbd

```tsx
<Kbd>⌘K</Kbd> <Kbd>F12</Kbd> <Kbd>↵</Kbd>
```

Rules:
- 20px tall, monospace, `surface-2` background, bottom-border 2px (recessed look).
- Every shortcut visible inline. **Tooltip-only shortcuts are banned** — staff never discover them.
- Inside a `primary` button (dark bg), use a translucent-white kbd treatment.

### 5.5 Status dot

**Variants:** `success` | `warning` | `danger` | `neutral` | `strong`. Add `pulse` for "live" only.

```tsx
<Dot variant="success" /> Synced
<Dot variant="danger" /> Offline
<Dot variant="strong" pulse /> Live
```

Rules:
- 6px circle. Always paired with text — never color alone (accessibility).
- On dark surfaces, dots auto-switch to on-dark shades.

### 5.6 Card

Three optional parts: `Card.Header`, `Card.Body`, `Card.Footer`.

```tsx
<Card>
  <Card.Header>
    <span className="font-semibold text-sm">GSTR-1</span>
    <Badge variant="success">Ready to file</Badge>
  </Card.Header>
  <Card.Body>…</Card.Body>
  <Card.Footer>…</Card.Footer>
</Card>
```

Rules: 1px border + `radius-lg`, no shadow by default. Header/footer get `surface` tint where useful; body stays `background`.

---

## 6. Patterns

Composed surfaces. Build these as `components/patterns/`.

### 6.1 Data table

The most-used pattern. Built on `@tanstack/react-table` + the `Table` primitive.

Rules:
- Sticky header (`position: sticky; top: 0`).
- Header: uppercase 11px, tracking-wide, `surface` background.
- Numeric columns: right-aligned + `tabular-nums`.
- Row divider: 1px `divider`. Hover tints to `surface`.
- Status badges in a dedicated rightmost column.
- Empty state replaces the `<tbody>` content, not the whole card.
- Compact density via `data-density="compact"` ancestor → 6px vertical cell padding.

### 6.2 Stat card

Structure: label (`text-xs` uppercase) → value (`text-2xl` bold tabular) → delta/hint (`text-xs` muted).

Rules:
- Sizes: tile (dashboard grid), panel, hero.
- **Inverse (black bg) reserved for the single headline number per screen.** On the inverse card, label/hint use `rgba(255,255,255,0.6)`, value uses pure white, deltas use on-dark semantic shades.

### 6.3 Page header

Fixed 56px. Title + subtitle left, actions right. Never two rows. Brand mark lives in the sidebar, not here.

```tsx
<PageHeader
  title="Counter Billing"
  subtitle={<>Counter 1 · Rahul Sharma · <Dot variant="success" pulse /> Online</>}
  actions={<Button variant="ghost" size="sm">Shortcuts <Kbd>?</Kbd></Button>}
/>
```

### 6.4 Empty state

Three lines: icon (in a `surface-2` circle), title (`text-sm` medium), hint (`text-xs` tertiary). Never overdesign.

### 6.5 Form row

Label above (`text-xs` uppercase tertiary) → input → helper text below (muted). Errors replace helper text in `danger` color.

### 6.6 Toast (corrected pattern)

**All toasts share one dark surface.** Semantic meaning carried by status dot + 3px left accent border using on-dark shades. **Never flood the background with a semantic color** — that produces muddy, broken-looking panels.

```tsx
<Toast variant="success">  {/* dark bg, emerald-400 accent + dot */}
  <Dot variant="success" />
  <div>
    <div className="font-medium">Bill #INV-2026-04827 saved</div>
    <div className="text-xs text-white/55">Synced to cloud · ₹487.50 collected</div>
  </div>
</Toast>
```

Rules:
- Inline feedback beats toasts for primary actions (checkmark next to the line item, not a disappearing toast).
- Toasts are for background events the user didn't initiate or isn't watching (sync status, cross-counter stock changes).

---

## 7. Accessibility (must pass before ship)

- **Contrast:** body on white ≥ 4.5:1 (AA). `text-tertiary` only on white, never on `surface-2`.
- **Focus:** every interactive element shows the solid 2px ring on `:focus-visible` (16:1 or more on white in light, 14:1 or more on surface-2 in dark). Never remove it, never make it translucent. Control borders are 3:1 or more (`--color-control`).
- **Keyboard:** tab order matches visual order. No traps. Esc closes any overlay.
- **Semantic HTML:** tables are `<table>`, buttons are `<button>`, headings sequential.
- **Color independence:** status never by color alone — pair with text or icon.
- **Reduced motion:** honor `prefers-reduced-motion` (handled globally in §2.1; kill pulse, replace transforms with opacity).
- **Zoom:** test at 100/125/150% (counter PCs are often zoomed).

---

## 8. Anti-patterns (do not do)

- ✕ Color-coded counter staff (avatars in red/blue/green). Use initials + zinc shades; color is for state.
- ✕ Decorative icons in stat cards. The number is the icon.
- ✕ Animated celebrations on bill save. The cashier bills 200×/day; confetti is a productivity tax.
- ✕ Tooltip-only keyboard shortcuts. If it's not inline, it doesn't exist.
- ✕ Modal-on-modal flows. Inline-expand on the main canvas instead.
- ✕ Toast for primary-action confirmation. Use inline feedback.
- ✕ Decorative dividers (shadows, gradients). Use a 1px `border` line.
- ✕ Inventing a new component when composition would do. "Card with a chart" is `Card` + chart, not `ChartCard`.
- ✕ Semantic-on-light color used as a background fill (the muddy-toast bug). Use on-dark shades or `-bg`/`-border` tints.
- ✕ Raw values in components (`bg-zinc-50`, `text-[13px]`, `p-[18px]`). Always tokens.

---

## 9. Component build order (for engineering)

When implementing the system in code, build in this order — each layer depends on the previous:

1. **Tokens** — `globals.css` + `tailwind.config.ts` (§2). Nothing else works without these.
2. **Primitives** — Button, Input, Badge, Kbd, Dot, Card (§5). Pure token consumers.
3. **Patterns** — DataTable, StatCard, PageHeader, EmptyState, FormRow, Toast (§6). Composed from primitives.
4. **Screens** — Billing, Purchase, Inventory, Payments, Tax, Customers. ~90% pattern composition, ~10% screen-specific glue.

A screen that contains raw Tailwind color/spacing utilities instead of tokens, or that re-implements a primitive inline, fails review.

---

## 10. Changelog

- **v0.1 (28 May 2026)** — Initial system. Tokens, primitives, patterns, accessibility, anti-patterns. Toast pattern corrected (dark-surface + accent, replacing the muddy semantic-fill bug found in the first prototype).
- **v0.2 (12 Oct 2026)**: P1 accessibility fixes from the design audit ([SALT-38](https://app.plane.so/claude-pri/projects/1454eb99-703c-4a36-9d03-f311d11d6e97/issues/29df4720-0e15-465f-a3e7-b20547d30e47)). Focus ring is now solid and global (2px outline, 2px offset, `--color-focus-ring` = `action-primary`) instead of a 15-30% alpha ring; added `--color-control` for input and outlined-control borders (the bridge `--input` points at it) while `--color-border` stays for cards and dividers.

---

*Living document. Changes require a PR with rationale. Tokens are versioned semantically. New primitives are documented here before use.*
