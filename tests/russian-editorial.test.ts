// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getHelpTopics, helpTopics } from '../src/help-content';
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
});
