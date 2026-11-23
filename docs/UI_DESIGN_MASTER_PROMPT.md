# TransGuard AI — Soft & Approachable Product Design Brief & UI Tool Specification

> **Purpose:** This document is a complete, end-to-end UI/UX design specification and prompt playbook for rebuilding the **TransGuard AI** web interface in **Google Stitch**, **Vercel v0**, **Magic Patterns**, or **Figma**.
>
> **Core Direction:** Transform TransGuard AI from a rigid, high-stress security dashboard into a **calm, warm, approachable, human-centered transit safety workspace** — featuring soft rounded geometry, generous breathing room, gentle layered depth, and reassuring interactions — while preserving **100% of TransGuard AI's 6-pillar edge CV monitoring workflows, validator audit controls, and backend API/Socket.IO contracts**.

---

## 1. Product Philosophy & Visual Direction

### Why a Softer, Friendlier Interface Matters for Transit Safety
Transit control-room operators and validators monitor live camera feeds, GPS maps, and incident queues for hours at a time. Harsh black-and-neon dashboards amplify eye strain and alarm fatigue. A calm, humane product language helps operators **stay composed, spot real threats faster, and make confident Accept/Reject validation decisions**.

### Design Inspiration (Principles, Not Templates)
- **Apple HIG & Craft** — tactile rounded surfaces, soft ambient depth, natural spring-like transitions, and optical clarity.
- **Notion & Loom** — calm whitespace, warm neutrals, welcoming empty states, and frictionless controls.
- **Stripe & Arc** — crisp information hierarchy, gentle color tinting, effortless scannability in tables and drawers.

### Strict Quality Guardrails (No AI Slop, Even in a Soft Style)
- **NO** garish purple/pink/cyan aurora blobs, floating background orbs, or decorative sparkles.
- **NO** heavy neon glows, saturated gradient buttons, or unreadable low-contrast glassmorphism over busy maps.
- **NO** fake filler charts, stock illustrations, or marketing hero copy inside operational views.
- **YES** to warm neutral canvases, soft `12px–20px` rounded surfaces, subtle layered shadows, generous internal padding, clear semantic status pills, and calm, reassuring micro-copy.

---

## 2. Design Token System (Light-First Default + Warm Dark Mode)

> **Theme Strategy:** Make **Warm Daylight Mode** the default welcoming presentation for calm readability, with a **Warm Slate Dark Mode** toggle for dim control rooms.

### 2.1 Color Palette

| Token | Light Mode (Default) | Warm Dark Mode | Usage |
| :--- | :--- | :--- | :--- |
| `bg-canvas` | `#F6F7FB` | `#101217` | Main application background canvas |
| `bg-surface` | `#FFFFFF` | `#171A21` | Primary cards, sheets, sidebars, table containers |
| `bg-subtle` | `#F1F3F8` | `#1E222B` | Soft input fills, table header bands, hover trays |
| `bg-elevated` | `#FFFFFF` | `#232834` | Modals, floating map cards, dropdown popovers |
| `border-soft` | `#E6E8F0` | `#2A2F3D` | Primary 1px structural borders & card edges |
| `border-divider` | `#EEF0F6` | `#222632` | Subtle row dividers & internal separators |
| `text-primary` | `#161B26` | `#F3F5F9` | Headings, primary labels, key metrics |
| `text-secondary` | `#525B6C` | `#9CA3B5` | Subtitles, descriptions, metadata keys |
| `text-muted` | `#858E9F` | `#6B7285` | Timestamps, helper captions, placeholders |
| `accent-primary` | `#3B66F5` | `#5B82FF` | Primary interactive buttons, active nav, focus rings |
| `accent-hover` | `#2D54DB` | `#7092FF` | Hover state for primary interactive elements |
| `accent-soft` | `#EEF2FF` | `rgba(91,130,255,0.14)` | Soft highlight backgrounds & selected rows |

### 2.2 Humane Semantic Status Colors
Used exclusively to communicate live telemetry and validator decisions without visual shouting:

| State / Meaning | Foreground (Light / Dark) | Soft Surface Tint (Light / Dark) | Border Tint |
| :--- | :--- | :--- | :--- |
| **Validator Accepted / Online / Safe** | `#15803D` / `#4ADE80` | `#ECFDF5` / `rgba(34,197,94,0.12)` | `rgba(34,197,94,0.28)` |
| **Validator Rejected / Critical Threat** | `#BE123C` / `#FB7185` | `#FFF1F2` / `rgba(244,63,94,0.12)` | `rgba(244,63,94,0.28)` |
| **Pending Review / High Warning** | `#B45309` / `#FBBF24` | `#FFFBEB` / `rgba(245,158,11,0.12)` | `rgba(245,158,11,0.28)` |
| **Info / Syncing / Multi-Angle** | `#1D4ED8` / `#60A5FA` | `#EFF6FF` / `rgba(59,130,246,0.12)` | `rgba(59,130,246,0.28)` |

### 2.3 Typography System
- **Primary UI Font:** `Plus Jakarta Sans` or `Inter` (loaded via Google Fonts, weights `400`, `500`, `600`, `700`).
  - Page Titles: `22px–24px`, `font-semibold (600)`, `tracking-[-0.02em]`, `leading-snug`.
  - Section / Card Titles: `15px–16px`, `font-semibold (600)`, `tracking-[-0.01em]`.
  - Body & Helper Text: `13px–14px`, `font-normal (400)`, `leading-relaxed (1.55)`.
  - UI Labels & Table Headers: `12px`, `font-medium (500)`, calm sentence case or soft small-caps (avoid aggressive ALL-CAPS shouting).
- **Structured Telemetry Font:** `JetBrains Mono` (strictly `font-variant-numeric: tabular-nums`) reserved for timestamps (`22:14:08`), FPS (`24.8 FPS`), confidence (`94.2%`), GPS coordinates (`10.5898, 76.0116`), Camera IDs (`CAM_01`), and Alert IDs.

### 2.4 Soft Geometry, Calm Spacing & Gentle Depth
- **Border Radii:**
  - Floating Modals & Major Sheets: `20px` (`rounded-2xl` / `rounded-[20px]`)
  - Cards, Panels & Map Drawers: `16px` (`rounded-2xl`)
  - Buttons, Inputs & Table Rows (hover): `10px–12px` (`rounded-xl`)
  - Status Badges & Filter Chips: `9999px` (`rounded-full`, soft tinted pills with subtle borders)
- **Spacing Scale:**
  - Page outer padding: `24px–32px` on desktop, `16px` on mobile.
  - Card internal padding: `20px–24px`.
  - Grid gutters: `20px` (`gap-5`).
  - Generous row heights (`48px–54px` in tables, `40px–44px` in inputs/buttons) so touch and mouse targets feel effortless.
- **Gentle Elevation (Soft Ambient Shadows):**
  - Resting Card: `0 1px 2px rgba(16, 24, 40, 0.04), 0 4px 14px rgba(16, 24, 40, 0.03)`
  - Floating Map Panels / Modals: `0 8px 30px rgba(16, 24, 40, 0.08), 0 1px 3px rgba(16, 24, 40, 0.04)`
  - Dark Mode Elevation: Subtle `1px` top inner highlight `inset 0 1px 0 rgba(255, 255, 255, 0.04)` + soft drop shadow `0 10px 30px rgba(0, 0, 0, 0.35)`.

### 2.5 Approachable Motion & Interaction Rules
- **Transition Curve:** `cubic-bezier(0.22, 1, 0.36, 1)` at `180ms–220ms` for hover lifts, active states, drawers, and modals.
- **Interactive Tactility:**
  - Cards that act as filters gently lift `-1px` with a softly tinted border on hover.
  - Primary buttons give gentle press compression (`scale(0.985)` on active).
  - Never apply a global `*` CSS transition rule (keep maps, videos, and scroll smooth at 60 FPS).
  - View switches use a calm `180ms` fade + `6px` vertical settle (`opacity 0→1, translateY(6px→0)`).

---

## 3. Global Navigation Shell & Responsive Strategy

### Persistent Navigation Shell
- **Desktop (`>= 1024px`):** Soft `256px` left navigation rail on `bg-surface` with a gentle `1px` right divider (`border-soft`).
  - **Top Brand Area:** Soft rounded square badge (`rounded-xl`, soft cobalt `#3B66F5`) with a friendly shield-check emblem + `TransGuard AI` + calm status pill (`Live · 6 Pillars`).
  - **Quick Search Bar:** Soft pill/rounded input (`Search views...` + `⌘K` keycap).
  - **4 Clear Navigation Groups:**
    1. **Live Operations:** `Dashboard` (Live Feed), `Spatial Map Tracking`
    2. **Safety & Validation:** `Incident Logs` (with subtle `Excel` pill), `Insights`, `Watchlist Queue`
    3. **Systems:** `Camera Nodes`
    4. **Workspace:** `My team`, `Docs`
  - **Active Nav Item:** Soft rounded pill highlight (`bg-accent-soft text-accent-primary font-semibold`), no harsh sharp lines.
  - **Footer:** Soft rounded operator initials avatar (warm slate/cobalt tint — no external placeholder URLs), operator name, gentle green `On Duty` dot, and a smooth Light/Dark theme switch button.
- **Tablet & Mobile (`< 1024px`):**
  - Clean floating top-left menu button opens a smooth slide-over navigation drawer with soft backdrop blur.
  - On **Spatial Map Tracking**, mobile/tablet users can toggle between the Live Stream sheet and the Incident Inspection sheet without clipped layouts or hidden panels.
  - All tables scroll smoothly inside rounded containers with sticky key columns and zero page-level horizontal overflow.

---

## 4. Master System Prompt (Paste First into Google Stitch, v0, or Magic Patterns)

```markdown
You are designing **TransGuard AI**, a real-time public-transit safety monitoring and incident validation web application used by human control-room operators.

### Visual Direction: Soft, Calm, Human-Centered Product Design
Design this interface with a warm, approachable, low-stress visual language inspired by **Apple HIG, Notion, Loom, and Stripe's calmest workspaces** — NOT a harsh sci-fi military terminal and NOT a generic purple-neon AI template.

### Key Aesthetic Specifications
- **Default Theme:** Warm, airy Daylight Mode (`#F6F7FB` canvas, `#FFFFFF` elevated cards/sheets, `#E6E8F0` soft 1px borders) with a cohesive Warm Slate Dark Mode (`#101217` canvas, `#171A21` cards, `#2A2F3D` borders).
- **Shapes & Radius:** Soft, tactile geometry — `16px–20px` rounded cards/panels/modals, `10px–12px` rounded buttons and inputs, gentle pill-shaped status tags (`rounded-full`) with soft tinted backgrounds.
- **Spacing & Depth:** Generous breathing room (`20px–24px` card padding, comfortable `20px` grid gaps), soft ambient layered shadows (`0 4px 16px rgba(16,24,40,0.05)`), zero harsh glows or neon borders.
- **Color Restraint:** Warm Charcoal primary text (`#161B26`), Soft Slate secondary text (`#525B6C`), Friendly Civic Cobalt (`#3B66F5`) for primary interactive accents, and muted humane status tints:
  - Validator Accepted / Online: Soft Emerald (`#15803D` on `#ECFDF5`)
  - Validator Rejected / Critical Alert: Warm Rose (`#BE123C` on `#FFF1F2`)
  - Pending Review / Warning: Warm Honey Amber (`#B45309` on `#FFFBEB`)
- **Typography:** `Plus Jakarta Sans` or `Inter` (`SemiBold` headings with `-0.02em` tracking, comfortable `1.55` line height) + `JetBrains Mono` (`tabular-nums`) selectively for timestamps, GPS, FPS, Camera IDs, and confidence percentages.
- **Strict Anti-AI-Slop Rules:** No floating radial gradient blobs, no animated background particles, no purple-to-pink gradients, no fake marketing stats. Every control must map directly to TransGuard AI's live monitoring and operator validation workflows.

### Persistent Left Navigation Rail (256px)
- Brand header: Rounded cobalt shield icon + `TransGuard AI` + calm `Live` green dot badge.
- Soft rounded search field (`Jump to view...` with `⌘K` hint).
- 4 Groups:
  - Live Operations: `Dashboard`, `Spatial Map Tracking`
  - Safety & Validation: `Incident Logs` (`Excel` badge), `Insights`, `Watchlist Queue`
  - Systems: `Camera Nodes`
  - Workspace: `My team`, `Docs`
- Bottom operator card: Warm initials avatar badge, operator username, `On Duty` indicator, Light/Dark theme toggle.
```

---

## 5. Per-Screen Prompts (Generate One Screen at a Time)

### Screen 1 — Operator Sign-In (`LoginView`)
```markdown
Design a calm, welcoming **Operator Sign-In** screen for TransGuard AI using the soft Daylight-first design system (`#F6F7FB` canvas, `#FFFFFF` rounded `20px` card, gentle ambient shadow, `#3B66F5` cobalt primary accent, zero floating blobs or neon gradients).

Layout:
- Balanced, calm split layout on desktop (clean centered card on mobile):
  - **Left Column (Warm Operational Overview):** Soft `#EEF2FF`/warm off-white rounded surface (`rounded-3xl` inset panel) showing the TransGuard AI emblem, friendly headline "Calm, real-time safety for public transit", a brief 2-line reassurance description, and 6 clean, soft rounded summary chips for the active edge AI pillars (`Overcrowding`, `Unattended Baggage`, `Fall Detection`, `Weapon Verification`, `Violence Detection`, `Multi-Angle Watchlist`) plus a subtle bottom pill: `Edge Vision · WebRTC · ESP32 GPS Connected`.
  - **Right Column (Sign-In Form):** Clean centered white form (`max-w-[400px]`, `rounded-2xl`, generous `p-8` padding, gentle shadow):
    - Soft pill badge: `Operator Access`
    - Title: `Welcome back` / Subtitle: `Sign in to open the TransGuard AI monitoring workspace.`
    - Friendly inputs (`h-11`, `rounded-xl`, soft border `#E6E8F0`, calm blue focus halo):
      - `Username` (`placeholder="Enter your username"`)
      - `Password` (`placeholder="••••••••"`) with smooth show/hide eye button
    - Soft rose inline error banner slot when authentication fails.
    - Full-width rounded primary button (`rounded-xl`, `#3B66F5`, gentle shadow): `Sign in to Dashboard`
    - Reassuring footer note: Lock icon + `Encrypted JWT session · Role-based access`.
```

---

### Screen 2 — Spatial Map Tracking & Validator Dispatch (`Spatial Map Tracking`)
```markdown
Design the **Spatial Map Tracking** workspace for TransGuard AI inside the soft 256px navigation shell.

Layout:
1. **Full-Bleed Interactive Transit Map (Center):**
   - Clean light-gray Esri transit map tiles (warm dark-gray tiles in dark mode) with uncluttered visibility.
   - Friendly, unmistakable GPS incident markers (soft circular pin with white ring and gentle pulse halo, colored Rose for Critical, Amber for High, Cobalt for Info).
   - Floating bottom-center pill showing live ESP32 vehicle status (`BUS_001 · Live GPS · 38 km/h · 9 Satellites`).
2. **Left Floating Sheet (`360px` wide, `rounded-2xl`, `bg-white/95`, soft shadow — "Live Surveillance Stream"):**
   - Warm header with title, soft count pill (`12`), and a rounded Filter toggle icon button.
   - Soft rounded search bar (`Filter camera or incident...`) + collapsible soft pill filters (`All`, `Fall`, `Overcrowding`, `Lost & Found`, `Security Threat`, `Face Match`).
   - Comfortable, scannable incident rows separated by subtle dividers (each row has generous `py-3.5 px-4` padding, rounded soft highlight when selected):
     - Row header: Soft severity dot, Camera ID (`CAM_01` mono), friendly pillar pill, optional `Accepted` (soft emerald pill) or `Rejected` (soft rose pill) badge, and tabular time (`22:14:08`).
     - Row body: Clear incident title (`Weapon Detected`, `Passenger Fall`, `Watchlist Match`, `Unattended Baggage`) + concise telemetry snippet (`94.2% confidence`, `14 people`, `48s unattended`, or subject name).
3. **Right Floating Sheet (`410px` wide, `rounded-2xl`, `bg-white/95`, soft shadow — "Incident Details & Validator Decision"):**
   - Soft rounded segmented tab control (`Overview` | `Metadata` | `Evidence`) + gentle round Close button.
   - Incident header: Soft pillar pill, severity pill, Camera ID, and timestamp.
   - Soft rounded summary card (`bg-[#F6F7FB] rounded-xl p-4`) with well-spaced key-value rows: `Detection Class`, `Edge Sensor`, `Model Confidence`, `GPS Location`, and `Validator Status` (showing `Validator Accepted (admin)`, `Validator Rejected (admin)`, or `Pending Validation`).
   - **Annotated Evidence Frame Preview:** Rounded `12px` 16:9 image container with subtle "Expand Frame" pill button.
   - **Approachable Validator Decision Card (Clear visual hierarchy, zero accidental clicks):**
     - Primary button (`rounded-xl h-10`, soft-solid Emerald `#15803D`): **`✓ Validator Accept (Trigger Alarm & Telegram)`**
     - Secondary button (`rounded-xl h-10`, soft Rose tint `#FFF1F2` with `#BE123C` text and soft border): **`✕ Validator Reject (Mark False Positive)`**
     - Calm tertiary action below a soft divider: `Delete Record` (expands cleanly into Confirm / Cancel pills).
```

---

### Screen 3 — Incident Validation Excel Log Table (`Incident Logs`)
```markdown
Design the **Incident Validation Excel Log** screen for TransGuard AI — making a full-featured audit spreadsheet feel remarkably calm, crisp, and pleasant to read while showing every alert **Validator Accepted** and **Validator Rejected**.

Layout (inside the 256px sidebar shell, generous `p-6 md:p-8` padding on `#F6F7FB` canvas):
1. **Friendly Page Header:**
   - Title: `Incident Validation Log` + soft green pill badge `Excel & CSV Ready`
   - Subtitle: `Review, filter, and export every alert Accepted or Rejected by dashboard validators.`
   - Right-side action bar:
     - Soft white `Refresh` button (`rounded-xl`)
     - Soft-solid Emerald **`Download Excel (.xls)`** button (`rounded-xl`, spreadsheet icon)
     - Soft white/cobalt-tinted **`Export CSV (.csv)`** button (`rounded-xl`, download icon)
2. **4 Clickable Summary KPI Cards (`grid-cols-4 gap-4`, `rounded-2xl`, `p-5`, gentle shadow — active filter gets a calm colored ring):**
   - `Total Logged Alerts` — large tabular number + calm subtitle (`X validated · Y pending`)
   - `Validator Accepted` — soft emerald accent pill `Approved`, large count + `% rate`, subtitle `Dispatched to ESP32 & Telegram`
   - `Validator Rejected` — soft rose accent pill `Rejected`, large count + `% rate`, subtitle `Archived as false positives`
   - `Pending Validation` — soft amber accent pill `Pending`, large count, subtitle `Awaiting validator decision`
3. **Calm Filter & Search Bar (`rounded-2xl bg-white p-3.5 border border-[#E6E8F0]`):**
   - Soft pill filter tabs: `All Alerts (N)` | `✓ Validator Accepted (N)` | `✕ Validator Rejected (N)` | `● Pending (N)`
   - Right controls: Rounded search input (`Search ID, camera, validator, type...`), Incident Type select menu, and soft segmented switch (`Excel Table` | `Evidence Cards`).
4. **Approachable Excel-Style Audit Table (`rounded-2xl bg-white border border-[#E6E8F0] overflow-hidden shadow-sm`):**
   - Top calm status strip (`bg-[#F6F7FB]`): `Sheet: Validator_Alert_Log · Showing X of Y entries` on the left; soft colored counters (`Accepted · Rejected · Pending`) on the right.
   - Clean, airy spreadsheet columns with subtle soft cell borders (`#EEF0F6`), sticky header, and comfortable `py-3.5 px-3.5` row breathing room:
     `#` | `Alert ID` (mono) | `Detected Time` (mono) | `Camera & Vehicle` (with subtle GPS subtitle) | `Incident Type & Summary` | `Confidence` (mono) | `Validator Decision` (soft pill: `✓ Validator Accepted` emerald, `✕ Validator Rejected` rose, `● Pending Review` amber) | `Validated By` | `Validated At` | `Evidence` (soft `rounded-lg` 16:9 thumbnail opening a clean lightbox modal) | `Quick Actions` (approachable rounded `Accept` and `Reject` pill buttons + subtle trash icon).
   - Gentle pastel row tinting (very light 2% tint for accepted/rejected rows) with smooth hover highlight.
```

---

### Screen 4 — Live Safety Operations (`Dashboard`)
```markdown
Design the **Live Safety Operations** monitoring workspace for TransGuard AI with calm spacing and effortless live video focus.

Layout:
- Header: Title `Live Safety Operations`, calm subtitle `Monitor real-time edge camera feeds and manage watchlist identities.`, right-side controls: rounded Camera Selector dropdown (`CAM_01 — Online`), soft emerald `Live Stream · WebRTC` status pill, and primary Cobalt button `+ Add Watchlist Target`.
- Main Content (`grid-cols-1 lg:grid-cols-12 gap-5`):
  - **Left 8 Columns (`rounded-2xl bg-white p-3 border border-[#E6E8F0] shadow-sm`):**
    - Clean framed 16:9 live video canvas (`rounded-xl overflow-hidden bg-[#0E1015]`) with minimal translucent rounded pill overlays: top-left Camera ID + green live dot, top-right Reconnect & Fullscreen circular icon buttons, bottom-left `WebRTC · 24.5 FPS` pill, bottom-right soft `REC` indicator.
  - **Right 4 Columns (Stacked Calm Status Cards):**
    - **Card 1 — Edge Pipeline Health (`rounded-2xl bg-white p-5`):** Friendly checklist with soft emerald status dots for `GPU FP16 Inference (YOLOv11s)`, `SigLIP Visual Verifier`, `512-D ArcFace Watchlist`, and `ESP32 Vehicle GPS Bridge`.
    - **Card 2 — Recent Detections (`rounded-2xl bg-white p-5`):** Clean list of the latest 4 detections with soft status pills and a `View all in Excel Log →` link.
- Below the monitor: Soft emerald dismissible confirmation toast/banner whenever a new Watchlist target is enrolled, showing their rounded thumbnail photo.
```

---

### Screen 5 — Watchlist Queue & 3-Photo Multi-Angle Modal (`Watchlist Queue`)
```markdown
Design the **Watchlist Queue & Biometric Gallery** screen and its **Add Target Modal** in TransGuard AI's calm, friendly product language.

Main Screen:
- Header: Title `Watchlist Queue`, subtitle `Enrolled identities synced automatically to connected edge camera nodes.`, buttons `Refresh` (soft white `rounded-xl`) and `+ Add Target` (cobalt `rounded-xl`).
- Search & Sync Bar: Rounded search input (`Search by name or subject ID...`) + calm inline summary (`Total Targets: N` + soft green pill `Edge Sync Active`).
- 4-Column Responsive Identity Card Grid (`gap-5`):
  - Each card (`rounded-2xl bg-white border border-[#E6E8F0] shadow-sm hover:-translate-y-0.5 transition`):
    - Top square portrait container (`rounded-t-2xl overflow-hidden`) with gentle floating pills: top-left `3/3 Angles · Centroid` (soft cobalt pill) or `1/3 Photo` (soft dark translucent pill), top-right `Active` (soft emerald pill), bottom-left compact rounded mini-thumbnails when 2–3 angles are uploaded.
    - Generous card body (`p-4`): Subject full name (`15px font-semibold`), soft monospace ID pill (`ID: a8f39c12`), date added, and a gentle inline `Remove` button that reveals calm `Confirm` / `Cancel` pills (zero harsh browser alerts).

Modal — "Add Watchlist Target" (`rounded-2xl max-w-lg bg-white shadow-2xl p-6`):
- Friendly header: `Add Watchlist Target` + reassuring helper text: `1 clear front photo is enough — you can optionally add up to 3 angles for stronger recognition.`
- `Identity Name` input (`rounded-xl h-11`).
- **3-Slot Rounded Square Photo Upload Grid (`grid-cols-3 gap-3`):**
  - Slot 1: `Front View` (soft cobalt dashed border + `Required` pill)
  - Slot 2: `Side / 30° Angle` (soft gray dashed border + `Optional` pill)
  - Slot 3: `Alt Lighting` (soft gray dashed border + `Optional` pill)
  - Uploaded slots render a crisp rounded preview with a gentle corner remove `×` button and file size caption.
- Dynamic friendly readiness indicator (`✓ 1 photo ready — add 2 more optional` or `✓ Multi-angle centroid active`).
- Primary submit button (`rounded-xl h-11 bg-[#3B66F5]`): `Register Target (N photos)`.
```

---

### Screen 6 — Camera Nodes Grid & Edge Provisioning (`Camera Nodes`)
```markdown
Design the **Camera Grid Operations** screen for TransGuard AI using soft cards, calm spacing, and clear hardware telemetry.

Layout:
- Header: Title `Camera Grid Operations`, calm status line (`2 online · 1 offline · 3 registered`), buttons `Refresh` and `+ Provision Node`.
- Responsive Multi-Camera Grid (`1`, `2x2`, or `3xN` depending on count):
  - Each camera wrapped in a soft `rounded-2xl` white/slate frame with a `rounded-xl` 16:9 live WebRTC player inside, subtle hover controls (`Reconnect`, `Fullscreen`), soft status pills (`Online`, `Offline`, `Connecting...`), and tabular FPS badge.
  - Friendly Empty State (`rounded-2xl border-dashed bg-white p-12`): Soft rounded camera icon container, clear title `No Active Cameras Connected`, helpful one-sentence guidance, and a soft rounded copyable CLI command pill.
- **Node Hardware Telemetry Card (`rounded-2xl bg-white border border-[#E6E8F0] overflow-hidden`):**
  - Clean table with comfortable row padding (`Camera ID`, `Status` soft pill, `Node Host` mono, `Throughput FPS` mono, `Last Heartbeat` mono).
- **Provision AI Edge Node Modal (`rounded-2xl max-w-md p-6`):**
  - Inputs for `Camera ID` (`e.g. CAM_02`) and `Stream Source` (`rtsp://192.168.1.100:554/stream or 0 for webcam`), calm validation helper text, `Cancel` + `Deploy Node` buttons.
```

---

### Screen 7 — AI Telemetry & Insights (`Insights`)
```markdown
Design the **AI Telemetry & Insights** analytics screen for TransGuard AI in a calm, Stripe/Apple-Health-inspired data storytelling style.

Layout:
- Header: Title `AI Telemetry & Insights`, subtitle `Live metrics across all 6 active transit safety pillars.`, right controls: soft pill segmented switcher (`Last 24h` | `Last 7 Days`) + `Export CSV` button.
- Top 4-Column KPI Row (`grid-cols-4 gap-5`, `rounded-2xl bg-white p-5`):
  - `Total Incidents` (large friendly tabular count + smooth curved sparkline + gentle trend badge)
  - `Active AI Nodes` (`online / total` + soft `RTSP / WebRTC` caption)
  - `Validator Consensus` (`Accepted` emerald vs `Rejected` rose summary + `Multi-frame + SigLIP` caption)
  - `Threat Level` (`Nominal` emerald or `Critical` rose + clear human-readable status note)
- **Incident Timeline Card (`rounded-2xl bg-white p-6`):**
  - Soft rounded-top vertical bar chart (calm cobalt `#3B66F5` bars with subtle hover tooltips and uncluttered time labels).
- **6-Pillar Detection Distribution (`grid-cols-5 gap-4`):**
  - Soft rounded cards (`Security & Threats`, `Fall Detections`, `Overcrowding Spikes`, `Unattended Baggage`, `Watchlist Matches`) with soft pastel icon badges, tabular counts, and rounded `6px` progress tracks.
- **Live Incident Activity Card (`rounded-2xl bg-white p-6`):**
  - Friendly chronological feed of recent Socket.IO detections with soft colored dots and tabular timestamps.
```

---

### Screen 8 — Team Roster & System Docs (`My team` & `Docs`)
```markdown
Design the **Operator Roster (`My team`)** and **Architecture Documentation (`Docs`)** views matching the same warm, calm design system:

- **My team:** 2-column layout (`rounded-2xl` white cards):
  - Left card: Operator profile header with warm initials badge, `Certified Validator · Level-2 Clearance` soft emerald pill, and friendly toggle-switch cards (`Critical Threat Push Alerts`, `Watchlist Telegram & SMS Escalation`) using smooth rounded iOS-style switches.
  - Right card: `Active Roster` list + subtle disabled `+ Invite Team Member` button with SSO tooltip.
- **Docs:** Clean editorial reading layout (`max-w-4xl`, `rounded-2xl bg-white p-7`):
  - Readable prose explaining the 4-process edge architecture (`capture`, `inference`, `publisher`, `telemetry`).
  - Two balanced soft-tinted sub-cards (`Active 6 Pillars` and `Streaming & Hardware Telemetry`).
  - Clean copyable CLI launch block (`bg-[#F6F7FB] rounded-xl p-4 font-mono`).
```

---

## 6. Technical & Backend Preservation Contract (Mandatory for Integration)

When exporting generated designs from **Google Stitch**, **Vercel v0**, **Magic Patterns**, or **Figma** back into `c:\Users\User\troon\frontend`, every visual component **must preserve** the following existing runtime contracts:

### 6.1 REST API Endpoints
| Feature | Endpoint | Payload / Query Contract |
| :--- | :--- | :--- |
| Operator Login | `POST /api/auth/login` | `{ username, password }` -> `{ token, user }` |
| Alert History & Summary | `GET /api/alerts/history?limit=300` | Optional `&status=REVIEWED\|DISMISSED\|NEW`; returns `{ data, pagination, summary: { total, accepted, rejected, pending } }` |
| Validator Accept / Reject | `PATCH /api/alerts/:id/acknowledge` | `{ status: 'REVIEWED' \| 'DISMISSED' }`; saves `reviewed_by`, `reviewed_at`; `REVIEWED` triggers ESP32 buzzer + Telegram alert |
| Excel / CSV Export | `GET /api/alerts/export?format=xls\|csv` | Optional `&status=...`; returns downloadable `.xls` or UTF-8 BOM `.csv` |
| Delete Alert | `DELETE /api/alerts/:id` | Permanently removes incident and emits `alert_deleted` |
| Watchlist CRUD | `GET /api/watchlist`, `POST /api/watchlist`, `DELETE /api/watchlist/:id` | `POST` uses `multipart/form-data` with field name `images` (1 required, up to 3 optional photos) + `name` |
| Edge Camera Nodes | `GET /api/edge/cameras`, `POST /api/edge/provision` | `POST` accepts `{ camera_id, rtsp_url }` (RTSP/HTTP URL, webcam index `0`, or `.mp4`) |
| Live ESP32 Telemetry | `GET /api/alerts/telemetry/:vehicleId` | Returns `{ online, has_fix, lat, lon, speed_kmph, satellites, age_ms }` |

### 6.2 Real-Time Socket.IO Events
- `initial_state` — Hydrates initial `alerts` and `cameras` on connect.
- `new_alert` — Appends live edge detections and triggers `ToastProvider` (with severity audio beep for `CRITICAL`).
- `alert_updated` — Syncs validator Accept (`REVIEWED`) / Reject (`DISMISSED`), `reviewed_by`, and `reviewed_at` across all open tabs.
- `alert_deleted` — Removes deleted incidents across all open tabs.
- `camera_status` — Live FPS and `ONLINE`/`OFFLINE`/`PROVISIONING` updates.

### 6.3 Preserved Core Media & Map Modules
- **Live Video:** Keep `WebRTCPlayer.jsx` (MediaMTX WHEP on `:8889` with automatic HLS fallback on `:8888`) and `LiveVideo` memoized so incoming alerts never freeze video playback.
- **Spatial Map:** Keep `IncidentMap.jsx` (`react-leaflet` + Esri Light/Dark Gray Canvas tiles) intact inside the new visual frame.
- **Automated Test Selectors (Vitest 25/25):**
  - `LoginView.jsx`: `placeholder="Enter your username"`, `autoComplete="current-password"`, `aria-label="Show password"` / `"Hide password"`, button text matching `/sign in/i`.
  - `CameraNodesView.jsx`: headings/text `"Camera Grid Operations"`, `"No Active Cameras Connected"`, `"Node Hardware Telemetry"`, `"Provision AI Edge Node"`, buttons `/provision node/i`, `/deploy node/i`, `/refresh/i`, inputs matching `/e\.g\. CAM_02/i` and `/rtsp:\/\/192\.168\.1\.100/i`.
