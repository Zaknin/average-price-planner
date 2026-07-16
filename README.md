# Average Price Planner

A browser-local planner for stock purchases, average-down analysis, future sales, and multiple saved holdings.

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

## Docker deployment on OpenStock

The Compose file binds only to the OpenStock LAN address:

```text
http://192.168.23.253:8091
```

Deploy or update:

```bash
cd /opt/stock-average-optimizer
docker compose up -d --build
docker compose ps
curl -fsS http://192.168.23.253:8091/healthz
echo
```

The Compose configuration binds only to `192.168.23.253:8091`; it does not publish the application on all network interfaces. This repository does not deploy to that server.

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

The Docker site (`http://192.168.23.253:8091`) and the GitHub Pages site use different web origins. Browsers therefore keep separate `localStorage` for each site: positions and plans saved on one do not appear on the other. Neither site sends this data to a server.

## Calculation behavior

For a buy, the new average is the weighted average of existing and newly purchased shares.

For a sale under average-cost accounting:

- Remaining shares keep the same average cost.
- Estimated realized profit/loss is `(sale price - average cost) × shares sold`.
- Commissions and taxes are not included.

The optimizer measures average-price mechanics only. It does not assess investment quality, risk, valuation, concentration, or likelihood of recovery.
