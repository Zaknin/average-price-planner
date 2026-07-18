import { findHelpTopic, helpGroups, helpTopicSearchText, helpTopics, type HelpBlock, type HelpTopic } from './help-content';

export type HelpRoute = 'home' | string;

export interface HelpCallbacks {
  backToCalculator: () => void;
}

const helpUi = {
  title: 'Average Price Planner',
  helpCenter: 'Help center',
  back: 'Back to calculator',
  browse: 'Browse help topics',
  searchLabel: 'Search help topics',
  searchPlaceholder: 'Try fees, results, DCA, backup, or cost basis',
  noMatches: 'No help topics match that search. Try a shorter word or clear the filter.',
  returnToSection: 'Return to the related calculator section',
  commonMistakes: 'Common mistakes',
} as const;

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]!));

export function helpRouteFromHash(hash = window.location.hash): HelpRoute | null {
  if (!hash.startsWith('#help')) return null;
  const slug = hash.replace(/^#help\/?/, '').trim();
  return slug && findHelpTopic(slug) ? slug : 'home';
}

export function helpHash(slug: HelpRoute): string {
  return slug === 'home' ? '#help' : `#help/${slug}`;
}

function topicLink(topic: HelpTopic, current: HelpRoute): string {
  return `<button type="button" class="help-topic-link ${current === topic.slug ? 'is-current' : ''}" data-help-topic="${topic.slug}" ${current === topic.slug ? 'aria-current="page"' : ''}><span>${escapeHtml(topic.title)}</span><small>${escapeHtml(topic.summary)}</small></button>`;
}

function topicNavigation(current: HelpRoute): string {
  return helpGroups.map((group) => `<section class="help-nav-group"><h3>${escapeHtml(group)}</h3>${helpTopics.filter((topic) => topic.group === group).map((topic) => topicLink(topic, current)).join('')}</section>`).join('');
}

function homeContent(query: string): string {
  const normalized = query.trim().toLowerCase();
  const matches = helpTopics.filter((topic) => !normalized || helpTopicSearchText(topic).includes(normalized));
  const cards = helpGroups.map((group) => {
    const groupTopics = matches.filter((topic) => topic.group === group);
    return groupTopics.length ? `<section class="help-home-group"><h2>${escapeHtml(group)}</h2><div class="help-topic-cards">${groupTopics.map((topic) => `<button type="button" class="help-topic-card" data-help-topic="${topic.slug}"><strong>${escapeHtml(topic.title)}</strong><span>${escapeHtml(topic.summary)}</span></button>`).join('')}</div></section>` : '';
  }).join('');
  return `<article class="help-article" aria-labelledby="helpArticleTitle"><p class="eyebrow">${helpUi.helpCenter}</p><h1 id="helpArticleTitle" tabindex="-1">How to use Average Price Planner</h1><p class="help-lead">This calculator helps you explore average-price, fee, and planning arithmetic. It does not provide financial advice or recommend purchases.</p><div class="help-beginner"><strong>Start with the basics.</strong><p>You do not need to use every section. Positions, Buy/Sell, Results, and Backups are enough for basic use.</p><ol><li>Positions and holdings</li><li>Testing a buy or sale</li><li>Reading the results</li><li>Fees</li><li>Future transaction plan</li><li>Backup and exports</li></ol></div><label class="help-search"><span>${helpUi.searchLabel}</span><input id="helpSearch" type="search" value="${escapeHtml(query)}" placeholder="${helpUi.searchPlaceholder}" autocomplete="off" /></label>${cards || `<div class="empty-state">${helpUi.noMatches}</div>`}</article>`;
}

export function renderHelpBlock(block: HelpBlock): string {
  if (block.type === 'paragraph') return `<p>${escapeHtml(block.text)}</p>`;
  if (block.type === 'steps') return `<section class="help-block"><h2>${escapeHtml(block.title ?? 'How to use it')}</h2><ol>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol></section>`;
  if (block.type === 'example') {
    const intro = block.intro ? `<p>${escapeHtml(block.intro)}</p>` : '';
    const rows = block.rows?.length ? `<dl class="help-example-rows">${block.rows.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join('')}</dl>` : '';
    const text = block.text?.length ? block.text.map((item) => `<p>${escapeHtml(item)}</p>`).join('') : '';
    return `<section class="help-example"><h2>${escapeHtml(block.title)}</h2>${intro}${rows}${text}</section>`;
  }
  if (block.type === 'result-list') return `<section class="help-block"><h2>${escapeHtml(block.title ?? 'What the results mean')}</h2><dl class="help-result-list">${block.items.map((item) => `<div><dt>${escapeHtml(item.term)}</dt><dd>${escapeHtml(item.explanation)}</dd></div>`).join('')}</dl></section>`;
  if (block.type === 'definitions') return `<section class="help-block"><h2>Definitions</h2><dl class="help-definitions">${block.items.map((item) => `<div><dt>${escapeHtml(item.term)}</dt><dd>${escapeHtml(item.definition)}</dd></div>`).join('')}</dl></section>`;
  if (block.type === 'topics') {
    const links = block.slugs.map(findHelpTopic).filter((topic): topic is HelpTopic => Boolean(topic));
    return `<section class="help-block"><h2>${escapeHtml(block.title ?? 'Related topics')}</h2><div class="help-topic-jumps">${links.map((topic) => `<button type="button" class="help-topic-jump" data-help-topic="${escapeHtml(topic.slug)}">${escapeHtml(topic.title)}</button>`).join('')}</div></section>`;
  }
  if (block.type === 'note' || block.type === 'warning') return `<aside class="help-callout ${block.type}" role="note"><strong>${escapeHtml(block.title ?? (block.type === 'warning' ? 'Important' : 'Note'))}</strong><p>${escapeHtml(block.text)}</p></aside>`;
  if (block.type === 'mistakes') return `<section class="help-block"><h2>${helpUi.commonMistakes}</h2><ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`;
  return '';
}

function topicContent(topic: HelpTopic): string {
  return `<article class="help-article" aria-labelledby="helpArticleTitle"><p class="eyebrow">${escapeHtml(topic.group)}</p><h1 id="helpArticleTitle" tabindex="-1">${escapeHtml(topic.title)}</h1><p class="help-lead">${escapeHtml(topic.summary)}</p><div class="help-topic-content">${topic.blocks.map(renderHelpBlock).join('')}</div><footer class="help-related"><button type="button" class="secondary-button" data-help-return-section="${topic.relatedSection}">${helpUi.returnToSection}</button></footer></article>`;
}

export function renderHelp(app: HTMLDivElement, route: HelpRoute, callbacks: HelpCallbacks, query = ''): void {
  const activeTopic = route === 'home' ? undefined : findHelpTopic(route);
  const effectiveRoute = activeTopic ? route : 'home';
  app.innerHTML = `<header class="topbar"><div class="brand"><span class="brand-mark" aria-hidden="true">A</span><div><h1>${helpUi.title} <span class="release-tag">v1.8.1</span></h1><p>${helpUi.helpCenter}</p></div></div><button id="helpBackTop" class="secondary-button">${helpUi.back}</button></header><main class="help-layout"><aside class="help-sidebar"><button id="helpBack" class="secondary-button help-back">← ${helpUi.back}</button><nav aria-label="Help topics"><div class="help-mobile-nav"><button id="toggleHelpTopics" class="text-button" aria-expanded="false" aria-controls="helpTopicNavigation">${helpUi.browse}</button></div><div id="helpTopicNavigation" class="help-topic-navigation">${topicNavigation(effectiveRoute)}</div></nav></aside><main class="help-main">${effectiveRoute === 'home' ? homeContent(query) : topicContent(activeTopic!)}</main></main>`;

  const goBack = (): void => callbacks.backToCalculator();
  app.querySelector<HTMLButtonElement>('#helpBack')?.addEventListener('click', goBack);
  app.querySelector<HTMLButtonElement>('#helpBackTop')?.addEventListener('click', goBack);
  app.querySelector<HTMLButtonElement>('#toggleHelpTopics')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    app.querySelector('#helpTopicNavigation')?.classList.toggle('is-expanded', !expanded);
  });
  app.querySelectorAll<HTMLButtonElement>('[data-help-topic]').forEach((button) => button.addEventListener('click', () => { window.location.hash = helpHash(button.dataset.helpTopic ?? 'home'); }));
  app.querySelectorAll<HTMLButtonElement>('[data-help-return-section]').forEach((button) => button.addEventListener('click', () => callbacks.backToCalculator()));
  const search = app.querySelector<HTMLInputElement>('#helpSearch');
  search?.addEventListener('input', () => renderHelp(app, 'home', callbacks, search.value));
  window.setTimeout(() => app.querySelector<HTMLElement>('#helpArticleTitle')?.focus({ preventScroll: true }), 0);
}
