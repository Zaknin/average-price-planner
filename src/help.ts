import { findHelpTopic, helpGroups, helpTopics, type HelpTopic } from './help-content';

export type HelpRoute = 'home' | string;

export interface HelpCallbacks {
  backToCalculator: () => void;
}

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
  return helpGroups.map((group) => `<section class="help-nav-group"><h3>${group}</h3>${helpTopics.filter((topic) => topic.group === group).map((topic) => topicLink(topic, current)).join('')}</section>`).join('');
}

function homeContent(query: string): string {
  const normalized = query.trim().toLowerCase();
  const matches = helpTopics.filter((topic) => !normalized || [topic.title, topic.summary, ...topic.keywords, topic.useful, topic.results].join(' ').toLowerCase().includes(normalized));
  const cards = helpGroups.map((group) => {
    const groupTopics = matches.filter((topic) => topic.group === group);
    return groupTopics.length ? `<section class="help-home-group"><h2>${group}</h2><div class="help-topic-cards">${groupTopics.map((topic) => `<button type="button" class="help-topic-card" data-help-topic="${topic.slug}"><strong>${escapeHtml(topic.title)}</strong><span>${escapeHtml(topic.summary)}</span></button>`).join('')}</div></section>` : '';
  }).join('');
  return `<article class="help-article" aria-labelledby="helpArticleTitle"><p class="eyebrow">Help center</p><h1 id="helpArticleTitle" tabindex="-1">How to use Average Price Planner</h1><p class="help-lead">This calculator helps you explore average-price, fee, and planning arithmetic. It does not provide financial advice or recommend purchases.</p><div class="help-beginner"><strong>New to the calculator?</strong> Start with Positions, then learn how to test a buy or sale. Scenario tools and DCA ladders are optional advanced features.</div><label class="help-search"><span>Search help topics</span><input id="helpSearch" type="search" value="${escapeHtml(query)}" placeholder="Try fees, DCA, backup, or break-even" autocomplete="off" /></label><p class="help-glossary-link"><button type="button" class="text-button" data-help-topic="glossary">Open the glossary</button></p>${cards || '<div class="empty-state">No help topics match that search. Try a shorter word or clear the filter.</div>'}</article>`;
}

function topicContent(topic: HelpTopic): string {
  return `<article class="help-article" aria-labelledby="helpArticleTitle"><p class="eyebrow">${topic.group}</p><h1 id="helpArticleTitle" tabindex="-1">${escapeHtml(topic.title)}</h1><section><h2>What this section does</h2><p>${escapeHtml(topic.summary)}</p></section><section><h2>When it is useful</h2><p>${escapeHtml(topic.useful)}</p></section><section><h2>How to use it</h2><ol>${topic.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></section><section><h2>Simple worked example</h2><div class="help-example">${escapeHtml(topic.example)}</div></section><section><h2>What the results mean</h2><p>${escapeHtml(topic.results)}</p></section><section><h2>Common mistakes</h2><ul>${topic.mistakes.map((mistake) => `<li>${escapeHtml(mistake)}</li>`).join('')}</ul></section><footer class="help-related"><button type="button" class="secondary-button" data-help-return-section="${topic.relatedSection}">Return to the related calculator section</button></footer></article>`;
}

export function renderHelp(app: HTMLDivElement, route: HelpRoute, callbacks: HelpCallbacks, query = ''): void {
  const activeTopic = route === 'home' ? undefined : findHelpTopic(route);
  const effectiveRoute = activeTopic ? route : 'home';
  app.innerHTML = `<header class="topbar"><div class="brand"><span class="brand-mark" aria-hidden="true">A</span><div><h1>Average Price Planner <span class="release-tag">v1.8</span></h1><p>Help center</p></div></div><button id="helpBackTop" class="secondary-button">Back to calculator</button></header><main class="help-layout"><aside class="help-sidebar"><button id="helpBack" class="secondary-button help-back">← Back to calculator</button><nav aria-label="Help topics"><div class="help-mobile-nav"><button id="toggleHelpTopics" class="text-button" aria-expanded="false" aria-controls="helpTopicNavigation">Browse help topics</button></div><div id="helpTopicNavigation" class="help-topic-navigation">${topicNavigation(effectiveRoute)}</div></nav></aside><main class="help-main">${effectiveRoute === 'home' ? homeContent(query) : topicContent(activeTopic!)}</main></main>`;

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
  app.querySelectorAll<HTMLButtonElement>('[data-help-return-section]').forEach((button) => button.addEventListener('click', () => {
    callbacks.backToCalculator();
    window.setTimeout(() => document.getElementById(button.dataset.helpReturnSection ?? '')?.scrollIntoView({ block: 'start' }), 0);
  }));
  const search = app.querySelector<HTMLInputElement>('#helpSearch');
  search?.addEventListener('input', () => renderHelp(app, 'home', callbacks, search.value));
  window.setTimeout(() => app.querySelector<HTMLElement>('#helpArticleTitle')?.focus({ preventScroll: true }), 0);
}
