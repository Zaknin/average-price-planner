# Development

## Requirements

- Node.js 22
- npm

## Validate locally

```bash
npm ci --no-audit --no-fund
npm test
npm run build
```

## Module overview

- `src/main.ts` orchestrates calculator UI and browser-local state.
- `src/calculator.ts` contains fee-aware transaction arithmetic.
- `src/domain.ts` and `src/planner.ts` contain scenarios and planning helpers.
- `src/data.ts` validates backup and CSV data.
- `src/help-content.ts` and `src/help.ts` own the in-app Help Center.

## GitHub Pages

The Pages workflow builds the Vite site from `main` and publishes `dist`. Vite uses relative assets so the same static build works under the repository Pages path.

## Contributions and releases

Keep changes dependency-free unless a maintainership decision explicitly approves otherwise. Preserve local-storage migration behavior, run the validation commands above, review staged files, and verify the Pages workflow after pushing `main`.
