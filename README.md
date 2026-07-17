# Average Price Planner

A browser-local planner for stock purchases, average-down analysis, future sales, and multiple saved holdings.

## Version 1.5.0

This release adds fee-aware buy and sell planning without changing browser-local storage or the completed responsive mobile design.

- Buy fees can be entered as a percentage or fixed amount and are included in cash required, cost basis, new average, budget recommendations, scenarios, and the curve.
- Sell fees reduce net proceeds and realized profit/loss while preserving the average cost of any remaining shares.
- Each saved position keeps independent Buy and Sell fee preferences; existing positions and plans migrate as zero-fee data.
- Planned transaction rows and mobile transaction cards show gross value, fee type and amount, total paid or net received, and the resulting position.

## Version 1.4.0

This release redesigns the mobile experience from 320 px through 430 px wide while keeping the desktop workspace and calculation behavior intact.

- Position navigation and the active-holding summary now appear before the calculator on phones.
- Holding fields and purchase settings move into an accessible **Edit holding** disclosure on phones.
- Results use a compact 2 × 2 grid; scenarios and planned transactions use mobile cards instead of desktop tables.
- The improvement curve is collapsed by default on phones and opens with **Show improvement curve**.
- The application uses smaller, touch-friendly spacing and controls without horizontal page scrolling.

## Version 1.3.0

This release makes the purchase controls easier to use:

- Purchase settings are always visible; the Advanced settings disclosure was removed.
- Both percentage sliders now run from 5% to 100%.
- The active position can be deleted even when it is the only position; a clean blank position is opened afterward.
- After adding a buy or sale to the plan, the share amount resets to 0 while the entered price stays unchanged.
- Slider dragging is smooth, with recalculation after release.

## Browser storage model

All holdings and plans are stored in `localStorage` for the exact website origin.

- Different visitors get separate data in their own browsers.
- Different browser profiles and devices do not share data.
- Private/incognito sessions may be discarded when closed.
- Clearing site data removes saved positions.
- The application has no backend, account system, analytics, or server-side database.

## Local development

Requires Node.js 22 and npm.

```bash
npm ci --no-audit --no-fund
npm run dev
```

## Test and build

```bash
npm test
npm run build
```

## Local Docker deployment

The Compose file requires an explicit local interface address and never defaults to `0.0.0.0`. Copy the example environment file, then set `BIND_ADDRESS` to an address assigned to the Docker host:

```bash
cp .env.example .env
# Edit .env and set BIND_ADDRESS to a local LAN address.
```

Deploy or update:

```bash
docker compose up -d --build
docker compose ps
# Replace YOUR_LAN_ADDRESS with the value configured in .env.
curl -fsS "http://YOUR_LAN_ADDRESS:8091/healthz"
echo
```

When running the `curl` command, use the same local interface address you placed in `.env`. This repository does not deploy to any self-hosted server.

## GitHub Pages

The included `.github/workflows/pages.yml` builds and publishes `dist` whenever `main` is pushed (or when the workflow is run manually). It uses Vite's relative asset base, so the same build works at the Docker root and under the repository Pages path.

After pushing the repository:

1. Open repository **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Run the `Deploy GitHub Pages` workflow or push to `main`.

GitHub Pages availability for a private repository depends on the account or organization plan. If it is unavailable, keep the repository private until an owner chooses a different visibility or hosting option. Do not include secrets or private server information in the frontend source.

## Publishing future updates

1. Run `npm ci --no-audit --no-fund`, `npm test`, and `npm run build` with Node.js 22.
2. Review `git status`, commit only source and configuration changes, and push to `main`.
3. The Pages workflow will test, build, and deploy the `dist` artifact. Check its result in the repository **Actions** tab.

## Separate browser-local data

Any self-hosted Docker site and the GitHub Pages site use different web origins. Browsers therefore keep separate `localStorage` for each site: positions and plans saved on one do not appear on the other. Neither site sends this data to a server.

## Calculation behavior

For a buy, the new average is the weighted average of existing and newly purchased shares.

For a sale under average-cost accounting:

- Remaining shares keep the same average cost.
- Estimated realized profit/loss is `(sale price - average cost) × shares sold`.
- Commissions and taxes are not included.

The optimizer measures average-price mechanics only. It does not assess investment quality, risk, valuation, concentration, or likelihood of recovery.
