# Reversal — отрицательное SOL-окно и state machine

Дата: 2026-07-31

## Проверка простых признаков

На приблизительном SOLUSDT Spot 5m no-signal окне из пользовательского скриншота:

- полный диапазон 20–21 июля Казахстан: 576 баров;
- более узкая оценка видимого участка: 397 баров.

Если весь показанный участок действительно не содержит Reversal labels, простые single-bar комбинации дают слишком много ложных срабатываний:

| Семейство | Ложных срабатываний на 100 баров, узкое окно |
|---|---:|
| directional candle | 97.23 |
| directional + Stochastic recovery | 12.34 |
| directional + body contraction | 39.80 |
| directional + MFI extreme | 20.65 |
| directional + RSI recovery | 8.56 |
| directional + Stochastic recovery + body contraction | 5.29 |

Вывод: ни RSI, ни Stochastic, ни MFI, ни свечная форма по отдельности формулой Reversal не являются.

## Проверка bounded state machine

Проверена схема:

```text
rolling 48-bar extreme
+ направленное displacement 0.6–1.0%
→ состояние живёт 8–16 баров
→ recovery + directional candle + body condition
→ signal
```

На positive sample лучшие варианты доходили до 7/11 совпадений в первоначальном агрегированном скане, но после честной проверки конкретной реализации на SOL 5m:

| Параметры | Positive recall | Сигналов в no-signal окне |
|---|---:|---:|
| 48 баров, move 1.0%, expiry 8 | 9.1% | 8 |
| 48 баров, move 1.0%, expiry 16 | 9.1% | 8 |
| 48 баров, move 0.6%, expiry 8 | 27.3% | 15 |
| 48 баров, move 0.6%, expiry 16 | 27.3% | 15 |

Эта постановка также отклонена: recall недостаточен, а ложные срабатывания остаются.

## Что это сужает

Reversal, вероятно, использует более специфичный Pine-compatible state:

1. не просто rolling high/low;
2. не просто один oscillator threshold;
3. возможно, crossover двух сглаженных компонентов;
4. возможно, composite fear/greed score из momentum + volatility + volume;
5. возможно, подтверждённый pivot/divergence с визуальным offset назад;
6. вероятно, отдельный cooldown/re-arm, сильно уменьшающий частоту повторных сигналов.

Следующий разумный family search:

```text
normalized momentum component
+ normalized volatility component
+ normalized volume component
→ smoothed composite 0..100
→ extreme state
→ crossover out of extreme
→ directional candle
→ cooldown until opposite/neutral reset
```

Это ближе к заявлению автора про «упрощённый страх и жадность» и всё ещё использует только OHLCV.

## Ограничение

Границы no-signal скриншота приблизительные. Результат достаточно силён, чтобы отвергнуть частые single-bar rules, но недостаточен для финального precision числа. Production Reversal/Apex и ветка `redesign/terminal-ui` не менялись.
