// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getHelpTopics, helpTopicSearchText, helpTopics } from '../src/help-content';
import { ru } from '../src/locales/ru';
import { plural, setLocale } from '../src/i18n';

const russianTopics = getHelpTopics('ru');

beforeEach(() => setLocale('ru'));

describe('Russian editorial parity', () => {
  it('keeps Help slugs, related sections, and worked-example coverage aligned with English', () => {
    expect(russianTopics.map((topic) => topic.slug)).toEqual(helpTopics.map((topic) => topic.slug));

    for (const englishTopic of helpTopics) {
      const russianTopic = russianTopics.find((topic) => topic.slug === englishTopic.slug);
      expect(russianTopic?.relatedSection).toBe(englishTopic.relatedSection);
      expect(russianTopic?.blocks.filter((block) => block.type === 'example')).toHaveLength(englishTopic.blocks.filter((block) => block.type === 'example').length);
    }
  });

  it('uses the approved Russian terminology and excludes retired developer-style wording', () => {
    const catalog = JSON.stringify({ ru, russianTopics });
    expect(catalog).toContain('Себестоимость позиции');
    expect(catalog).toContain('Сумма продажи до комиссии');
    expect(catalog).toContain('Сумма после комиссии');
    expect(catalog).toContain('Обратный расчёт продажи');
    expect(catalog).toContain('Создана копия сценария');
    expect(catalog).toContain('Остаток бюджета');
    expect(catalog).toContain('Максимум необходимых средств');
    expect(catalog).toContain('Средства, полученные от продаж');
    for (const retiredPhrase of ['Локальный в браузере', 'Сценарий дублирован', 'применены атомарно', 'Планировщик обратной продажи', 'арифметические сценарии', 'Базовая стоимость', 'Неиспользованный остаток', 'Высвобожденные деньги']) {
      expect(catalog).not.toContain(retiredPhrase);
    }
  });

  it('retains Russian singular, paucal, plural, and 21-item forms for dynamic counts', () => {
    expect(plural(1, 'сделка', 'сделки', 'сделок')).toBe('сделка');
    expect(plural(2, 'сделка', 'сделки', 'сделок')).toBe('сделки');
    expect(plural(5, 'сделка', 'сделки', 'сделок')).toBe('сделок');
    expect(plural(21, 'сделка', 'сделки', 'сделок')).toBe('сделка');
  });

  it('keeps substantive workflows, accounting distinctions, and export limits in Russian Help', () => {
    const textFor = (slug: string): string => helpTopicSearchText(russianTopics.find((topic) => topic.slug === slug)!);
    expect(textFor('getting-started')).toContain('применить исполненные сделки');
    expect(textFor('getting-started')).toContain('positions');
    expect(textFor('getting-started')).toContain('резервную копию');
    expect(textFor('positions')).toContain('максимальный бюджет');
    expect(textFor('positions')).toContain('0,01 допускает дробные');
    expect(textFor('market-snapshot')).toContain('оценочная стоимость после комиссии');
    expect(textFor('market-snapshot')).toContain('реализованный относится к уже проданным');
    expect(textFor('market-snapshot')).toContain('результат после плана');
    expect(textFor('future-plan')).toContain('комиссия покупки');
    expect(textFor('future-plan')).toContain('применение исполненных сделок');
    expect(textFor('dca-ladder')).toContain('остаток бюджета');
    expect(textFor('dca-ladder')).toContain('статус «исполнено»');
    expect(textFor('saved-scenarios')).toContain('завершённый');
    expect(textFor('saved-scenarios')).toContain('сохранить изменения / сохранить как новый');
    expect(textFor('scenario-comparison')).toContain('до четырёх сценариев вне архива');
    expect(textFor('executed-transactions')).toContain('сделки, которые будут учтены');
    expect(textFor('executed-transactions')).toContain('блокирует обновление целиком');
    expect(textFor('backup-export')).toContain('экспорт плана в csv');
    expect(textFor('backup-export')).toContain('csv-файлы пока нельзя импортировать');
    expect(textFor('backup-export')).toContain('не перезаписывает совпадающие записи молча');
  });

  it('uses the approved Russian glossary definitions and avoids deprecated phrasing', () => {
    const glossary = helpTopicSearchText(russianTopics.find((topic) => topic.slug === 'glossary')!);
    for (const definition of [
      'суммарные затраты, относящиеся к акциям, которые остаются в позиции',
      'наибольшая сумма собственных средств, которая потребуется до поступления денег от последующих продаж',
      'средства, полученные от продаж после вычета комиссий',
      'цена продажи, при которой результат после комиссии равен нулю',
      'заданная сценарная цена, используемая для расчёта результата позиции при другом уровне рынка',
      'изменения не обновляют сохранённый сценарий, пока пользователь явно их не сохранит',
      'исполненная сделка, которая уже использовалась для обновления сохранённой позиции',
    ]) expect(glossary).toContain(definition);
    for (const deprecated of ['архивный»', 'ручная цена «что если»', 'рабочее пространство']) expect(glossary).not.toContain(deprecated);
  });
});
