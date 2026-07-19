// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findHelpTopic, helpTopicSearchText, helpTopics } from '../src/help-content';
import { helpHash, helpRouteFromHash, renderHelp, renderHelpBlock } from '../src/help';
import { setLocale } from '../src/i18n';

const requiredRoutes = ['getting-started', 'positions', 'buy-sell', 'reading-results', 'fees', 'market-snapshot', 'target-tools', 'buying-guide', 'future-plan', 'scenario-planner', 'dca-ladder', 'saved-scenarios', 'scenario-comparison', 'reverse-sell', 'stress-tests', 'executed-transactions', 'backup-export', 'privacy', 'glossary'];

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  window.location.hash = '';
  localStorage.clear();
  setLocale('en');
});

describe('Help Center content and routes', () => {
  it('keeps every existing route, adds Reading the results, and falls back safely', () => {
    expect(helpTopics).toHaveLength(requiredRoutes.length);
    for (const slug of requiredRoutes) {
      expect(findHelpTopic(slug)?.title).toBeTruthy();
      expect(helpRouteFromHash(`#help/${slug}`)).toBe(slug);
      expect(helpHash(slug)).toBe(`#help/${slug}`);
    }
    expect(helpRouteFromHash('#help')).toBe('home');
    expect(helpRouteFromHash('#help/not-a-topic')).toBe('home');
    expect(helpRouteFromHash('#position')).toBeNull();
  });

  it('renders the beginner path and searches titles, definitions, headings, and examples', () => {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    renderHelp(app, 'home', { backToCalculator: vi.fn() });
    expect(app.textContent).toContain('You do not need to use every section.');
    expect(app.textContent).toContain('Reading the results');

    renderHelp(app, 'getting-started', { backToCalculator: vi.fn() });
    expect(app.querySelector('[data-help-topic="reading-results"]')).not.toBeNull();
    renderHelp(app, 'home', { backToCalculator: vi.fn() });

    const search = (value: string): string => {
      const input = app.querySelector<HTMLInputElement>('#helpSearch')!;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return app.textContent ?? '';
    };
    expect(search('diminishing returns')).toContain('Buying guide and diminishing returns');
    expect(search('cost basis')).toContain('Reading the results');
    expect(search('cash returned by sales')).toContain('Glossary');
    expect(search('no-such-help-topic')).toContain('No help topics match');
  });

  it('renders detailed Buying Guide, DCA, Scenario, Executed, and glossary content with semantic lists', () => {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    renderHelp(app, 'buying-guide', { backToCalculator: vi.fn() });
    expect(app.textContent).toContain('Buy 25 shares');
    expect(app.textContent).toContain('Buy 200 shares');
    expect(app.textContent).toContain('Diminishing-return reference');

    renderHelp(app, 'dca-ladder', { backToCalculator: vi.fn() });
    expect(app.textContent).toContain('Level 1 at $40');
    expect(app.textContent).toContain('Level 2 at $35');
    expect(app.textContent).toContain('Level 3 at $30');

    renderHelp(app, 'scenario-planner', { backToCalculator: vi.fn() });
    expect(app.textContent).toContain('Four separate layers');
    expect(app.textContent).toContain('Scenario workspace');

    renderHelp(app, 'executed-transactions', { backToCalculator: vi.fn() });
    expect(app.textContent).toContain('An order being considered.');
    expect(app.textContent).toContain('Rows to apply');

    renderHelp(app, 'glossary', { backToCalculator: vi.fn() });
    expect(app.querySelector('dl.help-definitions')).not.toBeNull();
    expect(app.querySelectorAll('.help-definitions dt').length).toBeGreaterThanOrEqual(32);
    expect(app.textContent).toContain('Cash released');
  });

  it('marks the current topic, opens the mobile topic disclosure, and returns without changing storage', () => {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    const back = vi.fn();
    localStorage.setItem('average-down-optimizer:v2', 'unchanged');
    renderHelp(app, 'reading-results', { backToCalculator: back });
    expect(app.querySelector('[aria-current="page"]')?.textContent).toContain('Reading the results');
    const disclosure = app.querySelector<HTMLButtonElement>('#toggleHelpTopics')!;
    disclosure.click();
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    app.querySelector<HTMLButtonElement>('#helpBack')?.click();
    expect(back).toHaveBeenCalledOnce();
    expect(localStorage.getItem('average-down-optimizer:v2')).toBe('unchanged');
  });

  it('escapes structured example values and keeps glossary search data separate from rendering', () => {
    const rendered = renderHelpBlock({ type: 'example', title: '<unsafe>', rows: [{ label: '<label>', value: '<script>bad()</script>' }] });
    expect(rendered).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(rendered).not.toContain('<script>bad()</script>');
    expect(helpTopicSearchText(findHelpTopic('glossary')!)).toContain('cash returned by sales');
    expect(helpTopicSearchText(findHelpTopic('buying-guide')!)).toContain('diminishing returns');
  });

  it('renders the Russian catalog on the same stable Help route', () => {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    setLocale('ru');
    expect(helpRouteFromHash('#help/reading-results')).toBe('reading-results');
    renderHelp(app, 'reading-results', { backToCalculator: vi.fn() });
    expect(app.textContent).toContain('Как читать результаты');
    expect(app.textContent).toContain('Сумма до комиссии');
    expect(app.querySelector('[data-locale="ru"]')?.classList.contains('active')).toBe(true);
    expect(app.querySelector('.locale-control')?.getAttribute('aria-label')).toBe('Language / Язык');
    expect(app.querySelector('[data-locale="ru"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(app.querySelector('[data-locale="en"]')?.getAttribute('aria-pressed')).toBe('false');

    renderHelp(app, 'home', { backToCalculator: vi.fn() });
    const search = app.querySelector<HTMLInputElement>('#helpSearch')!;
    search.value = 'cash released';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(app.textContent).toContain('Глоссарий');

    renderHelp(app, 'glossary', { backToCalculator: vi.fn() });
    expect(app.querySelectorAll('.help-definitions dt')).toHaveLength(32);
  });
});
