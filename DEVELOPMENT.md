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
- `src/help-types.ts` defines the typed, language-ready Help block model.
- `src/help-content.ts` contains the English topic catalog. Keep complete messages and examples in this file rather than in rendering code.
- `src/help.ts` renders typed blocks safely as paragraphs, steps, examples, result lists, definitions, notes, and warnings.

## Help content and future localization

Add a Help topic by creating a typed catalog entry with a stable slug and a related calculator-section ID. Keep article text, glossary definitions, example labels, and search keywords together in the catalog so another language can supply an equivalent catalog later. Generic Help interface strings are centralized in `src/help.ts`; a future localization pass will need to translate those strings as well as the catalog. Do not match application errors by English text or add a language control until that dedicated release.

## GitHub Pages

The Pages workflow builds the Vite site from `main` and publishes `dist`. Vite uses relative assets so the same static build works under the repository Pages path.

## Contributions and releases

Keep changes dependency-free unless a maintainership decision explicitly approves otherwise. Preserve local-storage migration behavior, run the validation commands above, review staged files, and verify the Pages workflow after pushing `main`.
