# polaris-components-test

Static specimen pages for Shopify **Polaris 2.0** web components (App Home / `s-*` elements), built to import into Figma for prototyping.

- `index.html` — foundations (fonts, type hierarchy, colors) followed by every component, with its variants, tones and states
- `foundations.js` — measures the foundations from the rendered components, so they always match the loaded Polaris version
- `capture.html` — one frame per component variant (169 frames), captioned in Figma's `Property=Value` variant format
- `figma-plugin/` — a local Figma plugin that turns the exported foundations into color variables and text styles
- `patterns.html` — composed patterns: metrics card, setup guide, callout, empty state, index table, resource list, settings

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

### 2. Components → capture sheet

1. Install the **html.to.design** Figma plugin and its Chrome extension.
2. Open `capture.html` and capture it (or one set at a time) with the extension.
3. For each set: rename every captured frame to its caption (e.g. `Variant=Primary, Tone=Critical, State=Disabled`), make each a component, select them all and choose **Combine as variants**. Name the set (e.g. `Button`). Figma creates the properties from the names.
4. Replace raw colors with the `Polaris` variables and raw text with the text styles, and add auto layout where the import used fixed positions.

Overlays (modal, popover, menu, tooltip) only render while open, so capture them from `index.html`.

### 3. Patterns

Build the patterns in `patterns.html` from instances of your new components rather than importing them.

Polaris renders inside Shadow DOM, so capture a single set first and check the result before importing everything.
