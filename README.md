# polaris-components-test

Static specimen pages for Shopify **Polaris 2.0** web components (App Home / `s-*` elements), built to import into Figma for prototyping.

- `index.html` — foundations (fonts, type hierarchy, colors) followed by every component, with its variants, tones and states
- `foundations.js` — measures the foundations from the rendered components, so they always match the loaded Polaris version
- `capture.html` — one frame per component variant (169 frames), captioned in Figma's `Property=Value` variant format, with a components export
- `components-export.js` — serialises the rendered variants (layout, boxes, text, icons) for the Figma plugin
- `figma-plugin/` — a local Figma plugin that turns the exports into color variables, text styles and native component sets
- `patterns.html` — composed patterns: metrics card, setup guide, callout, empty state, index table, resource list, settings
- `dashboard.html` — a dashboard skeleton in the new admin frame (expanded and collapsed side navigation), exportable as Figma template screens built from library instances

Components load from Shopify's CDN, so you need an internet connection. There is no build step.

- Default: `polaris-2.0-rc.js`. Outside the Shopify admin it renders in the **new admin design**.
- Add `?polaris=1` to the URL (e.g. `index.html?polaris=1`) to load `polaris-1.js` and compare with the previous design.

Polaris 2.0 is a release candidate, so its styling may still change before the stable release.

## View

- **Locally:** open `index.html` in Chrome.
- **Hosted:** in the repo, go to Settings → Pages, then deploy from this branch at the root (`/`). The site is served at `https://<user>.github.io/polaris-components-test/`.

## Build the Figma library

Work in this order: foundations first, so the components can use them.

### 1. Foundations → variables and text styles

There are two different JSON files involved; don't mix them up:

| File | Used for |
|---|---|
| `figma-plugin/manifest.json` (in this repo) | Installing the plugin, once |
| `polaris-foundations-….json` (from the site's **Download JSON** button) | The data you import, each time |

1. **Install the plugin (once).** In the **Figma desktop app**: main menu → Plugins → Development → **Import plugin from manifest…** and pick `figma-plugin/manifest.json` from the unzipped repo. Figma shows no confirmation; the plugin simply appears under Plugins → Development. Development plugins only run in the desktop app.
2. **Export.** Open `index.html`, wait for the measurements, then press **Download JSON** (or **Copy foundations JSON**).
3. **Import.** In your library file run Plugins → Development → **Polaris Foundations Import**, choose the downloaded file (or paste the copied JSON) and press **Import**.

You get:
- A **Polaris** variable collection with `Rendered/…` colors (sampled from real components, semantic names) and `Tokens/…` (Polaris' own CSS variables, if it exposes any).
- Text styles under `Polaris 2.0/…`. Styles that render identically are merged; the plugin's report lists which.
- A specimen frame that uses both, for a visual check.

Re-running updates in place. To add the old design as a second **mode**, open `index.html?polaris=1`, export again and import. Text styles have no modes, so they go into a separate `Polaris 1/…` folder. Free Figma plans allow only one mode per collection; the plugin then reports that it wrote into the existing mode.

### 2. Components → native component sets

1. Open `capture.html`, wait for **Export components JSON** to become active, and click it. You get `polaris-components-polaris-2-0.json`.
2. In your library file (with the foundations already imported), run **Polaris Foundations Import**, choose that file and press **Import**. The plugin detects which kind of file it is.

The plugin creates a new page with 24 component sets (169 variants):
- Variant properties come from the captions (`Variant=Primary, Tone=Critical, State=Disabled`).
- Flex containers become **auto layout**: buttons and badges hug their label, and fixed-width components (fields, banners, sections) fill their width.
- Colors are **bound to the Polaris variables** when the value matches exactly, and text uses your **text styles** when the spec matches. The report gives the counts.
- Icons come in as vectors. Images (avatars, thumbnails) are grey placeholders.

**Re-importing updates the library in place.** With *update the existing components page in place* ticked (the default), the plugin finds the `Polaris 2.0 components` page and updates it rather than building a new one:
- Component sets are matched by name and variants by their properties, so components keep their identity and instances in other files stay linked.
- Layers inside each variant are reused where the structure still matches, so instance overrides (a button label changed to "Save") survive the update. Icons are the exception: vectors are rebuilt, so an override on an icon's color resets.
- New variants and sets are added. Variants missing from the new export are **left untouched** and listed in the report, since instances may use them; delete them by hand once nothing does.
- Afterwards, **republish** the library; teammates get it as a normal library update to review and accept.

Untick the option to build a separate fresh page instead, e.g. to compare two Polaris versions side by side.

## Publishing the library

1. Move the file into a **team project** (not Drafts), then Assets panel → book icon (**Libraries**) → **Publish**. Requires a paid Figma plan; only editors can publish.
2. In the publish dialog, untick what shouldn't be shared. Names starting with `.` or `_` are never published, and variables have a *Hide from publishing* option. The hashed `Tokens/…` variables are usually best hidden; publish the `Rendered/…` ones (ideally renamed to your team's vocabulary).
3. Teammates enable it under Assets → Libraries, or an admin turns it on by default for the team/org.
4. To update: re-export, re-import (in place), check the report, republish.

Also captured: absolutely positioned `::before`/`::after` layers (borders, bevels, overlays), linear and radial gradient backgrounds (as Figma gradients), multi-layer shadows including spread (frames using spread get **Clip content**, which Figma needs to apply it), and icons drawn as CSS masks. Hidden text (e.g. a loading button's label) is kept, without a fill, so components keep their size. Polaris' `ShopifyInter` font falls back to Inter.

If something doesn't match the browser, press **Copy debug info** on the capture page: it copies the raw computed styles of a few representative variants as pasteable text.

Not covered: overlays (modal, popover, menu, tooltip), which only render while open; non-positioned pseudo-elements; raster background images; animation (the loading spinner is captured as a single frame).

Alternative: capture `capture.html` with the **html.to.design** plugin, then name each frame with its caption, make it a component and **Combine as variants**.

### 3. Patterns

Build the patterns in `patterns.html` from instances of your new components rather than importing them.

### 4. Templates → dashboard skeleton

`dashboard.html` is a starting point for a design: a real Polaris 2.0 dashboard (page header and actions, metrics row, recent orders table, setup guide, empty state) inside the **new admin frame**, in two screens: side navigation expanded and collapsed.

1. Build the components first (step 2), in the same file.
2. Open `dashboard.html` → **Export screens JSON**, and import the file with the plugin.

You get a `Polaris 2.0 templates` page with one 1440px frame per screen. Buttons, badges and checkboxes are **instances of your library components** with their labels overridden, so templates pick up library updates; everything else is plain layers. Re-importing replaces screens of the same name. Duplicate a template into your design files to start a design; the instances stay linked to the published library.

**The admin frame is an approximation.** The side navigation, search, store picker, notifications and the floating Sidekick input are drawn by the Shopify admin, not by Polaris, so they are hand-built from Shopify's description of the redesigned admin (dark collapsible side nav holding search, notifications and the store picker; no top bar; Sidekick as a floating chat input). Sizes, colors and icons aren't published: calibrate the CSS variables at the top of `dashboard.html` against a screenshot of your own admin, then re-export. Your app only controls its own entries under **Apps** (via `s-app-nav`) and the content panel.
