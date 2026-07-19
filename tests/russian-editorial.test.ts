// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getHelpTopics, helpTopicSearchText, helpTopics } from '../src/help-content';
import { ru } from '../src/locales/ru';
import { plural, setLocale, t } from '../src/i18n';

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
    expect(textFor('backup-export')).toContain('без незаметной перезаписи существующих записей');
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

  it('keeps the final Russian Help wording corrections in rendered content', () => {
    const textFor = (slug: string): string => helpTopicSearchText(russianTopics.find((topic) => topic.slug === slug)!);
    expect(textFor('getting-started')).toContain('пошаговый путь от создания позиции до сохранения резервной копии данных');
    expect(textFor('reading-results')).toContain('суммарные затраты, относящиеся к акциям, которые остаются в позиции');
    expect(textFor('dca-ladder')).toContain('общее количество акций');
    expect(textFor('dca-ladder')).not.toContain('накопленные количество');
    expect(textFor('saved-scenarios')).toContain('завершённый вариант сценария, сохранённый для истории');
    expect(textFor('reverse-sell')).toContain('количество для продажи не может превышать');
    expect(textFor('reverse-sell')).not.toContain('результат не может продать');
    expect(textFor('scenario-comparison')).toContain('различия в расчётных результатах');
    expect(textFor('executed-transactions')).toContain('статусы и результаты проверки');
    expect(textFor('executed-transactions')).not.toContain('статусы и строки просмотра');
    expect(textFor('backup-export')).toContain('без незаметной перезаписи существующих записей');
    expect(textFor('privacy')).toContain('отдельное серверное хранилище приложения');
  });

  it('keeps v1.9.6 Russian runtime messages factual and fully qualified', () => {
    for (const [shares, expected] of [
      ['1 акции', 'Нельзя продать больше 1 акции.'],
      ['2 акций', 'Нельзя продать больше 2 акций.'],
      ['5 акций', 'Нельзя продать больше 5 акций.'],
      ['21 акции', 'Нельзя продать больше 21 акции.'],
      ['1,5 акции', 'Нельзя продать больше 1,5 акции.'],
      ['0,25 акции', 'Нельзя продать больше 0,25 акции.'],
    ] as Array<[string, string]>) expect(t('cannotSellMore', { shares })).toBe(expected);
    expect(t('plannerInvalidTarget')).toBe('Введите числовое значение не меньше нуля.');
    expect(t('plannerInvalidLadderFee')).toBe('Введите нулевую или положительную комиссию.');
    expect(t('exportedBackup', { positions: 1, scenarios: 2 })).toBe('Резервная копия сохранена в JSON-файл: 1; сценариев: 2.');
    expect(t('confirmReplaceImport')).toContain('Позиции, планы и сценарии будут удалены и заменены.');
    expect(t('confirmReplaceImport')).toContain('рекомендуется экспортировать текущую резервную копию');
    expect(t('targetNetProceeds')).toBe('Целевая сумма после комиссии');
    expect(t('totalProjectedProfitLoss')).toBe('Расчётная итоговая прибыль/убыток');
    expect(t('estimatedGain')).toBe('расчётная прибыль');
    expect(t('estimatedLoss')).toBe('расчётный убыток');
    expect(t('plannerExecutionApplyFailed')).toBe('Не удалось учесть исполненные сделки в позиции.');
    expect(t('roundedTargetReached')).toBe('После округления итоговая средняя цена не превышает целевую.');
    expect(t('comparisonLimit')).toBe('Можно выбрать до четырёх сценариев вне архива.');
  });

  it('renders the v1.9.6 Help wording as reader-facing Russian prose', () => {
    const textFor = (slug: string): string => helpTopicSearchText(russianTopics.find((topic) => topic.slug === slug)!);
    expect(textFor('reading-results')).toContain('интерпретируйте показатель с учётом контекста');
    expect(textFor('fees')).toContain('комиссия рассчитывается от суммы до комиссии');
    expect(textFor('target-tools')).toContain('определяет требуемое количество или цену на основе заданной цели');
    expect(textFor('buying-guide')).toContain('для расчётного сравнения, а не как рекомендация к покупке');
    expect(textFor('future-plan')).toContain('одиночная операция рассчитывается отдельно от плана');
    expect(textFor('dca-ladder')).toContain('равное количество акций / заданные количества');
    expect(textFor('reverse-sell')).toContain('количество не рассчитывается');
  });
});
