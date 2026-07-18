// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findHelpTopic, helpTopics } from '../src/help-content';
import { helpHash, helpRouteFromHash, renderHelp } from '../src/help';

const requiredRoutes = ['getting-started', 'positions', 'buy-sell', 'fees', 'market-snapshot', 'target-tools', 'buying-guide', 'future-plan', 'scenario-planner', 'dca-ladder', 'saved-scenarios', 'scenario-comparison', 'reverse-sell', 'stress-tests', 'executed-transactions', 'backup-export', 'privacy', 'glossary'];

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  window.location.hash = '';
  localStorage.clear();
});

describe('Help Center content and routes', () => {
  it('includes every required topic and maps every direct Help route', () => {
    expect(helpTopics).toHaveLength(requiredRoutes.length);
    for (const slug of requiredRoutes) {
      expect(findHelpTopic(slug)?.title).toBeTruthy();
      expect(helpRouteFromHash(`#help/${slug}`)).toBe(slug);
      expect(helpHash(slug)).toBe(`#help/${slug}`);
    }
  });

  it('opens Help home and safely falls back for unknown routes', () => {
    expect(helpRouteFromHash('#help')).toBe('home');
    expect(helpRouteFromHash('#help/not-a-topic')).toBe('home');
    expect(helpRouteFromHash('#position')).toBeNull();
  });

  it('renders the Help home, filters by title and keyword, and clears the filter', () => {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    renderHelp(app, 'home', { backToCalculator: vi.fn() });
    expect(app.textContent).toContain('How to use Average Price Planner');
    const input = app.querySelector<HTMLInputElement>('#helpSearch')!;
    input.value = 'ladder';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const filteredCards = Array.from(app.querySelectorAll('.help-topic-cards')).map((element) => element.textContent).join(' ');
    expect(filteredCards).toContain('DCA Ladder');
    expect(filteredCards).not.toContain('Current market snapshot');
    const filtered = app.querySelector<HTMLInputElement>('#helpSearch')!;
    filtered.value = 'commission';
    filtered.dispatchEvent(new Event('input', { bubbles: true }));
    expect(app.textContent).toContain('Fees');
    const empty = app.querySelector<HTMLInputElement>('#helpSearch')!;
    empty.value = 'no-such-help-topic';
    empty.dispatchEvent(new Event('input', { bubbles: true }));
    expect(app.textContent).toContain('No help topics match');
    const cleared = app.querySelector<HTMLInputElement>('#helpSearch')!;
    cleared.value = '';
    cleared.dispatchEvent(new Event('input', { bubbles: true }));
    expect(app.textContent).toContain('Getting started');
  });

  it('marks the current topic, opens a compact topic disclosure, and returns to calculator', () => {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    const back = vi.fn();
    renderHelp(app, 'dca-ladder', { backToCalculator: back });
    expect(app.querySelector('[aria-current="page"]')?.textContent).toContain('DCA Ladder');
    expect(app.querySelector('#helpArticleTitle')?.textContent).toBe('DCA Ladder');
    const disclosure = app.querySelector<HTMLButtonElement>('#toggleHelpTopics')!;
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    disclosure.click();
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(app.querySelector('#helpTopicNavigation')?.classList.contains('is-expanded')).toBe(true);
    app.querySelector<HTMLButtonElement>('#helpBack')?.click();
    expect(back).toHaveBeenCalledOnce();
  });

  it('uses topic buttons to update the browser hash without touching local storage', () => {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    localStorage.setItem('average-down-optimizer:v2', 'unchanged');
    renderHelp(app, 'home', { backToCalculator: vi.fn() });
    app.querySelector<HTMLButtonElement>('[data-help-topic="privacy"]')?.click();
    expect(window.location.hash).toBe('#help/privacy');
    expect(localStorage.getItem('average-down-optimizer:v2')).toBe('unchanged');
  });
});
