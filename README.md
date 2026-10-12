# polaris-components-test

Static specimen pages for Shopify **Polaris 2.0** web components (App Home / `s-*` elements), built to import into Figma for prototyping.

- `index.html` — every component, with its variants, tones and states
- `patterns.html` — composed patterns: metrics card, setup guide, callout, empty state, index table, resource list, settings

Components load from Shopify's CDN, so you need an internet connection. There is no build step.

- Default: `polaris-2.0-rc.js`. Outside the Shopify admin it renders in the **new admin design**.
- Add `?polaris=1` to the URL (e.g. `index.html?polaris=1`) to load `polaris-1.js` and compare with the previous design.

Polaris 2.0 is a release candidate, so its styling may still change before the stable release.

## View

- **Locally:** open `index.html` in Chrome.
- **Hosted:** in the repo, go to Settings → Pages, then deploy from this branch at the root (`/`). The site is served at `https://<user>.github.io/polaris-components-test/`.

## Import to Figma

1. Install the **html.to.design** Figma plugin and its Chrome extension.
2. Import the hosted URL, or capture the open tab with the extension.
3. Import at 1440px for desktop and 375px for mobile; the components are responsive.
4. Modals, popovers, menus and tooltips render only when open. Open each one, then capture the tab.

Polaris renders inside Shadow DOM, so check a single section first before you import the whole page.
