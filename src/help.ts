import { findHelpTopic, getHelpTopics, helpGroups, helpTopicSearchText, type HelpBlock, type HelpTopic } from './help-content';
import { getLocale, t, type Locale } from './i18n';

export type HelpRoute = 'home' | string;

export interface HelpCallbacks {
  backToCalculator: () => void;
  changeLocale?: (locale: Locale) => void;
}

function groupLabel(group: string): string {
  if (getLocale() !== 'ru') return group;
  return ({ 'New users': 'Новые пользователи', 'Understand your position': 'Понимание позиции', 'Advanced planning': 'Расширенное планирование', 'Your data': 'Ваши данные' } as Record<string, string>)[group] ?? group;
}

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]!));

export function helpRouteFromHash(hash = window.location.hash, locale: Locale = getLocale()): HelpRoute | null {
  if (!hash.startsWith('#help')) return null;
  const slug = hash.replace(/^#help\/?/, '').trim();
  return slug && findHelpTopic(slug, locale) ? slug : 'home';
}

export function helpHash(slug: HelpRoute): string {
  return slug === 'home' ? '#help' : `#help/${slug}`;
}

function topicLink(topic: HelpTopic, current: HelpRoute): string {
  return `<button type="button" class="help-topic-link ${current === topic.slug ? 'is-current' : ''}" data-help-topic="${topic.slug}" ${current === topic.slug ? 'aria-current="page"' : ''}><span>${escapeHtml(topic.title)}</span><small>${escapeHtml(topic.summary)}</small></button>`;
}

function topicNavigation(current: HelpRoute): string {
  const topics = getHelpTopics(getLocale());
  return helpGroups.map((group) => `<section class="help-nav-group"><h3>${escapeHtml(groupLabel(group))}</h3>${topics.filter((topic) => topic.group === group).map((topic) => topicLink(topic, current)).join('')}</section>`).join('');
}

function homeContent(query: string): string {
  const normalized = query.trim().toLowerCase();
  const topics = getHelpTopics(getLocale());
  const matches = topics.filter((topic) => !normalized || helpTopicSearchText(topic).includes(normalized));
  const cards = helpGroups.map((group) => {
    const groupTopics = matches.filter((topic) => topic.group === group);
    return groupTopics.length ? `<section class="help-home-group"><h2>${escapeHtml(groupLabel(group))}</h2><div class="help-topic-cards">${groupTopics.map((topic) => `<button type="button" class="help-topic-card" data-help-topic="${topic.slug}"><strong>${escapeHtml(topic.title)}</strong><span>${escapeHtml(topic.summary)}</span></button>`).join('')}</div></section>` : '';
  }).join('');
  const sectionTopics = getLocale() === 'ru' ? ['Позиции и активы', 'Проверка покупки или продажи', 'Как читать результаты', 'Комиссии', 'План будущих операций', 'Резервные копии и экспорт'] : ['Positions and holdings', 'Testing a buy or sale', 'Reading the results', 'Fees', 'Future transaction plan', 'Backup and exports'];
  return `<article class="help-article" aria-labelledby="helpArticleTitle"><p class="eyebrow">${t('helpCenter')}</p><h1 id="helpArticleTitle" tabindex="-1">${t('helpHomeTitle')}</h1><p class="help-lead">${t('helpHomeLead')}</p><div class="help-beginner"><strong>${t('helpStart')}</strong><p>${t('helpBasics')}</p><ol>${sectionTopics.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol></div><label class="help-search"><span>${t('searchHelpTopics')}</span><input id="helpSearch" type="search" value="${escapeHtml(query)}" placeholder="${t('searchHelpPlaceholder')}" autocomplete="off" /></label>${cards || `<div class="empty-state">${t('noHelpMatches')}</div>`}</article>`;
}

export function renderHelpBlock(block: HelpBlock): string {
  if (block.type === 'paragraph') return `<p>${escapeHtml(block.text)}</p>`;
  if (block.type === 'steps') return `<section class="help-block"><h2>${escapeHtml(block.title ?? t('howToUseIt'))}</h2><ol>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol></section>`;
  if (block.type === 'example') {
    const intro = block.intro ? `<p>${escapeHtml(block.intro)}</p>` : '';
    const rows = block.rows?.length ? `<dl class="help-example-rows">${block.rows.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join('')}</dl>` : '';
    const text = block.text?.length ? block.text.map((item) => `<p>${escapeHtml(item)}</p>`).join('') : '';
    return `<section class="help-example"><h2>${escapeHtml(block.title)}</h2>${intro}${rows}${text}</section>`;
  }
  if (block.type === 'result-list') return `<section class="help-block"><h2>${escapeHtml(block.title ?? t('whatResultsMean'))}</h2><dl class="help-result-list">${block.items.map((item) => `<div><dt>${escapeHtml(item.term)}</dt><dd>${escapeHtml(item.explanation)}</dd></div>`).join('')}</dl></section>`;
  if (block.type === 'definitions') return `<section class="help-block"><h2>${t('definitions')}</h2><dl class="help-definitions">${block.items.map((item) => `<div><dt>${escapeHtml(item.term)}</dt><dd>${escapeHtml(item.definition)}</dd></div>`).join('')}</dl></section>`;
  if (block.type === 'topics') {
    const links = block.slugs.map((slug) => findHelpTopic(slug, getLocale())).filter((topic): topic is HelpTopic => Boolean(topic));
    return `<section class="help-block"><h2>${escapeHtml(block.title ?? t('relatedTopics'))}</h2><div class="help-topic-jumps">${links.map((topic) => `<button type="button" class="help-topic-jump" data-help-topic="${escapeHtml(topic.slug)}">${escapeHtml(topic.title)}</button>`).join('')}</div></section>`;
  }
  if (block.type === 'note' || block.type === 'warning') return `<aside class="help-callout ${block.type}" role="note"><strong>${escapeHtml(block.title ?? (block.type === 'warning' ? t('important') : t('note')))}</strong><p>${escapeHtml(block.text)}</p></aside>`;
  if (block.type === 'mistakes') return `<section class="help-block"><h2>${t('commonMistakes')}</h2><ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`;
  return '';
}

function topicContent(topic: HelpTopic): string {
  return `<article class="help-article" aria-labelledby="helpArticleTitle"><p class="eyebrow">${escapeHtml(groupLabel(topic.group))}</p><h1 id="helpArticleTitle" tabindex="-1">${escapeHtml(topic.title)}</h1><p class="help-lead">${escapeHtml(topic.summary)}</p><div class="help-topic-content">${topic.blocks.map(renderHelpBlock).join('')}</div><footer class="help-related"><button type="button" class="secondary-button" data-help-return-section="${topic.relatedSection}">${t('returnToCalculatorSection')}</button></footer></article>`;
}

export function renderHelp(app: HTMLDivElement, route: HelpRoute, callbacks: HelpCallbacks, query = ''): void {
  const activeTopic = route === 'home' ? undefined : findHelpTopic(route, getLocale());
  const effectiveRoute = activeTopic ? route : 'home';
  app.innerHTML = `<header class="topbar"><div class="brand"><span class="brand-mark" aria-hidden="true">A</span><div><h1>${t('documentTitle')} <span class="release-tag">v1.9.1</span></h1><p>${t('helpCenter')}</p></div></div><div class="header-actions"><div class="locale-control" role="group" aria-label="${t('language')}"><button type="button" data-locale="en" class="${getLocale() === 'en' ? 'active' : ''}">${t('english')}</button><button type="button" data-locale="ru" class="${getLocale() === 'ru' ? 'active' : ''}">${t('russian')}</button></div><button id="helpBackTop" class="secondary-button">${t('backToCalculator')}</button></div></header><main class="help-layout"><aside class="help-sidebar"><button id="helpBack" class="secondary-button help-back">← ${t('backToCalculator')}</button><nav aria-label="${t('browseHelpTopics')}"><div class="help-mobile-nav"><button id="toggleHelpTopics" class="text-button" aria-expanded="false" aria-controls="helpTopicNavigation">${t('browseHelpTopics')}</button></div><div id="helpTopicNavigation" class="help-topic-navigation">${topicNavigation(effectiveRoute)}</div></nav></aside><main class="help-main">${effectiveRoute === 'home' ? homeContent(query) : topicContent(activeTopic!)}</main></main>`;

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
  app.querySelectorAll<HTMLButtonElement>('[data-locale]').forEach((button) => button.addEventListener('click', () => callbacks.changeLocale?.(button.dataset.locale === 'ru' ? 'ru' : 'en')));
  const search = app.querySelector<HTMLInputElement>('#helpSearch');
  search?.addEventListener('input', () => renderHelp(app, 'home', callbacks, search.value));
  window.setTimeout(() => app.querySelector<HTMLElement>('#helpArticleTitle')?.focus({ preventScroll: true }), 0);
}
