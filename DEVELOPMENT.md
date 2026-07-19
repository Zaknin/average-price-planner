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
- `src/version.ts` is the single build-time application-version source; UI release labels and JSON backup `applicationVersion` metadata must use it.
- `src/data.ts` validates backup and CSV data. Backup validation returns stable, language-neutral error codes; the UI localizes those codes at the presentation boundary.
- `src/help-types.ts` defines the typed, language-ready Help block model.
- `src/i18n.ts` owns the `en` / `ru` preference, `Intl` formatting, interpolation, plural selection, document metadata, and English fallback. The preference key is separate from the portfolio store and backups.
- `src/locales/` contains interface translations; `src/help-content.ts` and `src/help-content.ru.ts` contain the English and Russian topic catalogs.
- `src/help.ts` renders typed blocks safely as paragraphs, steps, examples, result lists, definitions, notes, and warnings for the selected locale.

## Help content and localization

Add a Help topic to both typed catalogs with the same stable slug and related calculator-section ID. Keep article text, glossary definitions, example labels, and search keywords together in each catalog. Translate UI copy through `i18n.ts`; do not persist locale data in the portfolio store or backups.

Translation catalogs are compiler-checked for English/Russian key parity. UI validation must select a stable message code and then translate that code; it must not infer a translation by matching an English diagnostic string. `t()` safely falls back to English when a catalog entry is unavailable, so implementation code must never render raw keys or diagnostic codes.

### Russian editorial standard

Russian copy should read as a clear financial-planning interface, not as a literal technical translation. Use direct action labels (`Создать копию`, `Открыть сценарий`, `Учесть исполненные сделки`) and explain the financial effect before implementation details. Avoid developer metaphors such as “снимок”, “песочница”, “рабочее пространство” and avoid presenting internal mechanics as the primary message.

Use the same calculation terms throughout the interface and Help:

| English | Russian |
| --- | --- |
| Average price | Средняя цена |
| Cost basis | Себестоимость позиции |
| Market value | Рыночная стоимость |
| Gross purchase / Gross sale | Сумма покупки / продажи до комиссии |
| Net proceeds | Сумма после комиссии |
| Realized / Unrealized P/L | Реализованный / Нереализованный P/L |
| Break-even | Безубыточность |
| Scenario workspace | Рабочая копия сценария |
| Maximum capital requirement | Максимум необходимых средств |
| Cash released | Средства, полученные от продаж |

English terms may appear in parentheses on first use in the glossary, Help, or an otherwise technical explanation. Do not mix competing Russian terms for the same metric in nearby UI copy.

Keep the Russian Help catalog in substantive parity with English: every stable slug and related section must match, and each English worked example needs a Russian worked example with the same inputs, outputs, and fee behavior. Compare the substantive content block by block: introductory guidance, steps, definitions, notes, warnings, common mistakes, examples, result explanations, workflow distinctions, accounting distinctions, contextual links, and search keywords. Match examples by intent rather than copying English word order. Preserve technically meaningful words such as “сценарий”, “план”, “запланированный”, “исполненный”, and “отменённый”.

Russian interface strings with counts must use `plural()` in `i18n.ts` so singular, paucal, and plural forms are selected correctly; tests must cover 1, 2, 5, and 21. Keep `Intl` formatting and localized decimal parsing at display/input boundaries only.

Test complete rendered Russian sentences, not only a noun helper. Cover 1, 2, 5, and 21 for every rendered count family, plus fractional quantities; distinguish standalone and grammatical-case count phrases instead of appending a fixed noun. Fractional share quantities use the neutral form `акции` (for example, `0,25 акции` and `1,5 акции`). Review Help as continuous prose: the subject of a calculated result must remain grammatically and logically valid, and developer-oriented table terminology must not replace financial workflow terminology. Test complete Russian validation and backup messages, preserve semantic qualifiers such as target, projected, and estimated, and ensure backup notices accurately describe file downloads and the scope of data replacement. Perform sentence-level Russian QA for natural grammar, complete transaction summaries, and the absence of developer-style phrases. Use the user-facing status set `Черновик`, `Активный`, `Завершённый`, `В архиве` for scenarios and `Запланировано`, `Исполнено`, `Отменено`, `Учтено в позиции` for transactions. Keep `Средняя цена`, `Себестоимость позиции`, `Сумма продажи до комиссии`, and `Сумма после комиссии` distinct, and keep developer jargon out of user-facing text.

Use `Intl.NumberFormat`, `Intl.DateTimeFormat`, and `Intl.PluralRules` through `i18n.ts` for display values. `parseLocalizedDecimal()` accepts either a Russian decimal comma or a decimal point in supported numeric inputs and rejects ambiguous grouping/separator formats. Convert the result to a number before calculations; do not localize values retained in state.

The portfolio store remains schema v4 and the backup document remains schema v2. Locale preference uses `average-price-planner:locale`, separately from `average-down-optimizer:v2`, and is excluded from JSON backups. JSON and CSV preserve their canonical numeric, enum, date, and UTF-8/BOM formats regardless of UI locale. Backup `applicationVersion` is informational and must not change import compatibility. New backup-validation codes require English/Russian catalog entries plus tests for the code and both rendered messages. Persist empty scenario names when the user has not supplied one; render the localized fallback only in the UI. The EN/RU control is a bilingual labelled button group with exactly one `aria-pressed="true"` button after every render.

## GitHub Pages

The Pages workflow builds the Vite site from `main` and publishes `dist`. Vite uses relative assets so the same static build works under the repository Pages path.

## Contributions and releases

Keep changes dependency-free unless a maintainership decision explicitly approves otherwise. Preserve local-storage migration behavior, run the validation commands above, review staged files, and verify the Pages workflow after pushing `main`.
