# Design System: Dark Compact Dashboard (shadcn/ui v4 + Vercel Geist)

The visual design system for analytical trading applications, charts, event tables, and metric dashboards is built strictly on **shadcn/ui v4 achromatic neutral base** with **Vercel Geist typography**.

---

## 1. Tokens & Color System

The base is strictly achromatic (`C = 0` in oklch). No blue or warm tints in neutral grays.

```css
:root, .dark {
  --background: #0a0a0a;
  --card: #171717;
  --popover: #171717;
  --elev: #262626;        /* Muted surfaces: tiles, rows, track, hover */
  --muted: #262626;
  --accent: #262626;
  --foreground: #fafafa;
  --muted-foreground: #a1a1a1;

  /* Semi-transparent borders composite dynamically over underlying surfaces */
  --border: rgb(255 255 255 / 10%);
  --input:  rgb(255 255 255 / 15%);
  --ring:   #737373;

  /* Primary is strictly white. No colored primary exists in this system */
  --primary: #fafafa;
  --primary-foreground: #0a0a0a;

  /* Single-token semantic indicators */
  --success: #4ade80;
  --destructive: #f87171;
  --warning: #fbbf24;

  /* Dataviz extensions */
  --purple: #9a7bff;      /* Timeouts / secondary indicators */
  --cyan: #38bdf8;        /* Interactive chart accents */

  --font: "Geist", "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --mono: "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
}
```

### Dynamic Border Transparency
`white/10%` resolves as:
- `#222222` on page background (`#0a0a0a`)
- `#2e2e2e` on card background (`#171717`)
- `#3c3c3c` on tile surface (`#262626`)

A single border token automatically clarifies depth hierarchy across nested layers.

---

## 2. Corner Radii

Radii are derived strictly from a single base token via multipliers:

```css
--radius: 0.625rem;                        /* 10px base */
--radius-sm: calc(var(--radius) * 0.6);    /* 6px  — Badges, checkboxes */
--radius-md: calc(var(--radius) * 0.8);    /* 8px  — Buttons, inputs */
--radius-lg: var(--radius);                /* 10px — Tiles, list rows, tab tracks */
--radius-xl: calc(var(--radius) * 1.4);    /* 14px — Cards */
```

---

## 3. Typography & Scale

The interface uses strictly **three font sizes**. Hierarchy is created using font weights (400, 500, 600) and color opacity (`--foreground` / `--muted-foreground`).

| Size | Role |
|------|------|
| **12px** | Subtitles, card descriptions, badges, secondary table values |
| **14px** | Interface base: buttons, inputs, checkboxes, card headers, table body |
| **24px** | Large metrics (R values, totals, percentages) |

### Typography Guidelines
- **Primary Font**: Geist, fallback Inter, system-ui.
- **Monospace Font**: Geist Mono, fallback JetBrains Mono.
- **Tracking**: Body `-0.006em`, card titles `-0.012em`, metric numbers `-0.028em`.
- **Card Titles**: `14px / 600 / line-height: 1`, regular sentence casing (no uppercase transformations).
- **Card Descriptions**: `12px / 400 / --muted-foreground`.
- **Numeric Formatting**: `font-variant-numeric: tabular-nums` (prevents layout shifts on value updates).
- **Monospace Usage**: Monospace is reserved exclusively for numbers, prices, timestamps, versions, and system IDs.

---

## 4. Spacing & Rhythm

- **Card Internal Padding**: `24px` on all sides.
- **Card Body Vertical Gap**: `20px`.
- **Inter-Card Gap**: `16px`.
- **Group Element Gap** (button row, input grid): `8px`.
- **Icon-Text Gap**: `6px`.

---

## 5. Component Specifications

### Card
- `background: --card` (`#171717`), `border: 1px solid --border`, `border-radius: 14px`, no elevation shadow.
- Structure: Header (`14px/600`) + Description (`12px/muted`) grouped on the left; actions placed on the right.

### Button
- Height: **32px**, `padding: 0 12px`, `radius: 8px`, `14px / 500`.
- **Primary**: `background: --primary` (`#fafafa`), `color: --primary-foreground` (`#0a0a0a`). Maximum **one primary button per card**.
- **Outline**: Transparent background, `border: 1px solid --input`, hover `background: --muted`.
- **Ghost**: Transparent background, `color: --muted-foreground`, hover `background: --muted`, hover text `--foreground`.
- **Icon-only**: Square 32×32px.

### Input / Select
- Height: **36px**, `padding: 0 12px`, `radius: 8px`, `14px`, transparent background, `border: 1px solid --input`, hover background `white/3%`.
- Requires `white-space: nowrap; overflow: hidden`. Custom styled triggers only (no native system inputs or select arrows).

### Badge
- Height: **20px**, `padding: 0 8px`, `radius: 6px`, `12px / 500`, sans-serif typography.
- **Outline**: `border: 1px solid --input`, text muted.
- **Secondary**: `background: --muted`, no border, text `--foreground`.

### Checkbox
- 16×16px, `radius: 6px`, border `--input`.
- Checked state: `background: --primary` with a 12px Lucide `check` icon in `--primary-foreground`. Label `14px / --foreground`.

### ToggleGroup / Segmented Tabs
- Track: `background: --muted` (`#262626`), `radius: 10px` (`--radius-lg`), `padding: 3px`.
- Active Tab: `background: --primary` (`#fafafa`), `color: --primary-foreground` (`#0a0a0a`), `radius: 6px` (`--radius-sm`), `font-weight: 600`, subtle shadow `0 1px 2px rgb(0 0 0 / 0.4)`.
- Inactive Tabs: `color: --muted-foreground` (`#a1a1a1`), transparent background.

### Metric Tile
- `background: --muted` (`#262626`), **no border**, `radius: 10px`, `padding: 16px`.
- Structure: Label `12px muted` → Value `24px/600 tabular-nums` → Subtitle `12px muted`.
- Value color: `--success` (positive), `--destructive` (negative), `--muted-foreground` (zero/neutral).

### List Row
- `background: --muted` (`#262626`), **no border**, `radius: 10px`, `padding: 12px 14px`. Single row baseline alignment.

### Tables & Key-Value Pairs
- Separated exclusively by `divide-y` with `--border`.
- No outer border box, no row background fills.

### Separator
- Height: `1px`, `background: --border`. Used to delineate sections without wrapping elements in borders.

---

## 6. Iconography

- **Library**: Lucide SVG icons exclusively.
- **Dimensions**: **16px**, `stroke-width: 2`, `stroke-linecap: round`, `stroke-linejoin: round`, `stroke: currentColor`.
- **Unicode Glyphs**: Raw text symbols (`⌄ › ‹ ← → ↑ ↓ ✓ ✕ ×`) are prohibited. Use `chevron-down`, `chevron-right`, `arrow-left`, `arrow-right`, `arrow-up`, `check`, `x`, `circle-help`, `plus`, `download`, `trending-up`.

---

## 7. Panel Dimensions & Layout Constraints

- **Sidebar / Control Panel Width**: Minimum **400px** (optimal 420px).
- Necessary to accommodate 14px text density, 24px card padding, and formatted numeric triples (`tabular-nums`) without text wrapping or key truncation.
