---
name: airtel-design-system
description: Apply the Udyam Digital visual system, an Airtel-inspired identity for the fictional Accel Business product, covering colours, typography, spacing, reusable components, mobile-first layout, accessibility and enterprise-grade polish. Use whenever building or reviewing any screen, component, chart or demo UI in this project. Takes precedence over generic design skills such as ui-ux-pro-max and frontend-design.
---

# Airtel-Inspired Design System

This is the single source of visual truth for the prototype. Generic design skills can suggest ideas, but these tokens and rules win.

## Brand boundary

The product is **Accel Business**, the fictional operator in the case. The look is inspired by the hackathon's red, white and charcoal identity.

- Product screens say "Accel Business" and use our own simple wordmark.
- **Never put the Airtel logo, name or SYNC artwork inside the product.** They belong only on the organisers' submission template.
- Don't carry the binary-rain background into the product. It's for the deck.

## Design principles

1. **A busy owner, one hand, patchy network.** Assume a mid-range Android phone on 4G, used between customers.
2. **One decision per screen.** Show one primary action. Move detail into expandable sections.
3. **Price and status are never hidden.** The monthly total stays visible during the quote, and the current step stays visible in KYC and tracking.
4. **Earn trust with restraint.** KYC and payment screens are calm and plain, with no decoration.
5. **Plain words.** No product codes, no telecom jargon.
6. **Enterprise, not startup-flashy.** Use crisp alignment and consistent spacing, with no gradients or glow effects.

## Colour tokens

Base values come from the case document (`#E40000`, `#1B1B1B`, `#5A5A5A`, `#FFF1F1`, `#FFF7F7`). The contrast figures have been calculated.

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--brand` | `#E40000` | Primary buttons, key accents | White text 4.89:1 |
| `--brand-strong` | `#C40000` | Pressed state, red text on tint | On `--brand-tint` 5.71:1 |
| `--brand-tint` | `#FFF1F1` | Selected and highlight backgrounds | |
| `--brand-tint-soft` | `#FFF7F7` | Table stripes, soft sections | |
| `--ink` | `#1B1B1B` | Body text and headings | On white about 17:1 |
| `--ink-muted` | `#5A5A5A` | Secondary text | On white about 7:1 |
| `--surface` | `#FFFFFF` | Page and cards | |
| `--surface-alt` | `#F5F5F5` | Grouped backgrounds | |
| `--line` | `#E3E3E3` | Decorative dividers only | |
| `--line-strong` | `#8C8C8C` | Input and control borders | About 3.4:1 on white |
| `--success` / `--success-tint` | `#0B6B3A` / `#E8F5EE` | Verified, done | 5.89:1 |
| `--warning` / `--warning-tint` | `#8A5A00` / `#FFF6E0` | Needs attention | 5.51:1 |
| `--danger` / `--danger-tint` | `#B00020` / `#FDECEC` | Errors, rejected | 6.41:1 |
| `--info` | `#1D4ED8` | Links, neutral information | On white 6.7:1 |

Rules:

- `--brand` on `--brand-tint` is only 4.44:1, so **use `--brand-strong` for red text on tint**.
- Use `--danger` for errors, not `--brand`. A red brand needs a clearly different error colour, plus an icon and text.
- Never rely on colour alone to show status.
- Red is for one primary action per screen. If everything is red, nothing stands out.
- Dark mode is out of scope for the demo unless everything else is done. Define colours as CSS variables so it can be added.

## Typography

Poppins matches the case document and covers Latin and Devanagari. Other scripts need Noto Sans fallbacks.

```css
--font-sans: 'Poppins', 'Noto Sans Devanagari', 'Noto Sans Tamil', 'Noto Sans Telugu',
  'Noto Sans Kannada', 'Noto Sans Gujarati', 'Noto Sans Bengali', 'Noto Sans Gurmukhi',
  'Noto Sans Malayalam', system-ui, sans-serif;
```

Load only the script a user's locale needs, via `next/font`.

| Style | Size / line height | Weight | Use |
|---|---|---|---|
| `display` | 28 / 36 | 700 | Screen hero, price total |
| `h1` | 24 / 32 | 700 | Screen title |
| `h2` | 20 / 28 | 600 | Section title |
| `h3` | 18 / 26 | 600 | Card title |
| `body` | 16 / 24 | 400 | Default |
| `body-sm` | 14 / 22 | 400 | Secondary |
| `caption` | 12 / 18 | 500 | Metadata only |

- Never set body text below 16 px on mobile, which also stops iOS zooming on focus.
- Indic scripts need about 10% more line height. Add it through a `:lang()` rule.
- Use tabular numerals for prices and tables.
- Identifiers such as GSTINs use a monospace face, so O and 0 are distinguishable.

## Spacing and shape

- 4 px base: `4, 8, 12, 16, 24, 32, 48, 64`.
- Screen gutter 16 px; card padding 16 px; gap between sections 24 px.
- Radius: `8` controls, `12` cards, `16` bottom sheets, `999` pills.
- One shadow only: `0 1px 3px rgb(0 0 0 / .12)` for floating elements. Cards use borders by default.
- Icons: `lucide-react`, 20 or 24 px, always paired with a label unless the meaning is universal.

## Layout

- **Design at 360 px first**, then 768 and 1200. No horizontal scrolling at 320 px.
- Single column on phones, with a content max width of 560 px for owner flows.
- Back-office screens may use the full width with tables from 1024 px.
- Keep the primary action in a sticky bottom bar, inside the safe area.
- Touch targets are at least 48 × 48 px, with 8 px between them.

## Reusable components

Build these in `src/components/ui`, with props for every state. Check here before creating anything new.

| Component | Requirements |
|---|---|
| `Button` | primary, secondary, ghost, danger; loading and disabled states; 48 px high |
| `Input`, `Select`, `OtpInput` | Visible label, helper and error text, correct `inputmode` |
| `Card`, `Section` | Border by default; optional selected state |
| `Badge` | success, warning, danger, neutral; icon and text |
| `Toggle` | Real switch role; label and price on add-on rows |
| `Stepper` | Vertical; done, current, upcoming and failed |
| `BottomSheet` | Focus trap; closes with Esc and swipe |
| `Skeleton`, `EmptyState`, `ErrorState` | Each with a retry where relevant |
| `ChatBubble`, `QuickReply`, `TypingIndicator` | Advisor conversation; `aria-live="polite"` |
| `LanguageSwitcher` | Each language named in its own script |
| `PriceBar` | Sticky monthly total, setup fee, contract; updates as add-ons change |
| `BundleLine` | Plain name, reason, quantity stepper, price |
| `UploadTile` | Camera or file, progress, thumbnail, per-document status |
| `ConsentBlock` | Purpose list, retention, withdraw link; unticked by default |
| `MaskedValue` | Masked identifier with an explicit reveal |
| `DataTable`, `KpiTile` | Back office: sortable, sticky header, stacked on mobile |

## Key screens

- **Advisor:** full-height chat, quick-reply chips above the input, a persistent "See my bundle" once a recommendation exists, and a form fallback if the LLM fails.
- **Quote:** the bundle as plain lines with toggles, and a sticky `PriceBar`. A blocked add-on is shown disabled with its reason, not hidden.
- **KYC:** progress at the top and consent first, then one document at a time. Each result says exactly what to do next.
- **Tracker:** a vertical stepper with a date against every stage from `typical_install_days`, and the answer to "what happens next and when" above the fold. This exists to replace the 3 chase calls per customer.
- **Back office:** a dense, calm table of leads the advisor couldn't close, with a propensity score and the reason.

## States and motion

Every data-driven view needs loading, empty, error and success states. Keep the user's work after any failure.

Motion is 150 to 200 ms ease-out, for feedback only. Respect `prefers-reduced-motion`.

## Language and content

- All UI strings come from message catalogues. Allow for strings up to 40% longer than English.
- Currency is `₹28,080` via `Intl.NumberFormat('en-IN')`; dates are `15 Jul 2026`.
- Sentence case everywhere. Buttons say what happens, such as "Upload GST certificate".
- Errors say what happened and what to do next, with no codes or blame.

## Accessibility (WCAG 2.2 AA)

- Use semantic HTML first. ARIA only where HTML can't express it.
- Keep a visible focus ring: `2px solid var(--ink)` with a 2 px offset.
- Tie errors to fields with `aria-describedby`, and move focus to the first error on submit.
- Set `lang` on the document and on any mixed-language chat bubble.
- Announce chat and verification results through a live region.
- Run `axe` in Playwright on every key screen, at zero serious violations.

## Tailwind setup

```css
@theme {
  --color-brand: #E40000;
  --color-brand-strong: #C40000;
  --color-brand-tint: #FFF1F1;
  --color-ink: #1B1B1B;
  --color-ink-muted: #5A5A5A;
  --color-line: #E3E3E3;
  --color-line-strong: #8C8C8C;
  --color-success: #0B6B3A;
  --color-warning: #8A5A00;
  --color-danger: #B00020;
}
```

Never hard-code a hex value or an arbitrary spacing value in a component.

## Review checklist

- [ ] Works at 360 px and 320 px with one hand, no horizontal scroll
- [ ] One primary action; 48 px targets
- [ ] Tokens only, no raw hex
- [ ] Loading, empty, error and success states exist
- [ ] Hindi renders correctly and long strings don't break layout
- [ ] No product IDs or unmasked identifiers on screen
- [ ] No Airtel logo or name in the product
- [ ] `axe` is clean and keyboard flow works
