# E3 — Плацебо-нормированный NET-пересчёт (ZC5 SELECTIVE и pd_premium)

EXPLORATORY re-measurement. NET (7 bps/сторона), 5 фиксов внутри `replayE3Trade`,
плацебо K=20 (±30 дней, valid-band-only, same symbol+side), cluster-aware bootstrap
(2000 ресемплов, seed 20260807, кластер = (side, 4h-bucket)).

**Kill-criteria (per leg):** KILL если ЛЮБОЕ — mean excess < +0.05R (net), ИЛИ
bootstrap p > 0.0167, ИЛИ mean excess < 0 на OOS. Иначе SURVIVES.

## Leg — ZC5 SELECTIVE

TIMESTOP (медиана длин stop/TP-закрытых сделок, in-sample) = **113** баров.

| группа | n | End-mark rate | mean netR | mean placebo netR | mean excess | bootstrap p | clusters | short-share |
|---|---|---|---|---|---|---|---|---|
| IN-SAMPLE (12 ZC5) | 53 | 50.9% | -0.0428 | -0.0475 | 0.0047 | 0.4790 | 48 | 88.7% |
| OOS (unseen) | 116 | 62.9% | -0.0869 | -0.0668 | -0.0201 | 0.6415 | 111 | 80.2% |

**Вердикт: ❌ KILLED**

Сработавшие kill-условия:
- mean excess 0.0047R < +0.05R (in-sample)
- bootstrap p 0.4790 > 0.0167
- OOS mean excess -0.0201R < 0

Профиль short-beta: доля шортов in-sample 88.7%, OOS 80.2% — перекос в шорт заметен (возможная short-beta).

### Per-asset breakdown

| asset | split | n | mean netR | mean excess |
|---|---|---|---|---|
| BTC | in | 6 | -0.0955 | -0.0170 |
| ETH | in | 6 | -0.0259 | 0.0415 |
| SOL | in | 6 | 0.0674 | 0.1513 |
| XRP | in | 11 | 0.0406 | 0.1312 |
| BNB | in | 11 | 0.0453 | 0.0226 |
| DOGE | in | 13 | -0.2222 | -0.1920 |
| 1000PEPE | oos | 13 | 0.1585 | 0.1965 |
| AAVE | oos | 14 | -0.1555 | -0.1059 |
| ARB | oos | 23 | -0.2444 | -0.1461 |
| ENA | oos | 28 | -0.1077 | -0.0071 |
| OP | oos | 20 | -0.0428 | -0.0456 |
| SUI | oos | 18 | -0.0261 | 0.0593 |

## Leg — pd_premium (D3)

TIMESTOP (медиана длин stop/TP-закрытых сделок, in-sample) = **147** баров.

| группа | n | End-mark rate | mean netR | mean placebo netR | mean excess | bootstrap p | clusters | short-share |
|---|---|---|---|---|---|---|---|---|
| IN-SAMPLE (12 ZC5) | 225 | 50.7% | -0.0404 | -0.0746 | 0.0342 | 0.2235 | 181 | 99.1% |
| OOS (unseen) | 203 | 51.2% | 0.0213 | -0.0620 | 0.0834 | 0.0440 | 168 | 98.5% |

**Вердикт: ❌ KILLED**

Сработавшие kill-условия:
- mean excess 0.0342R < +0.05R (in-sample)
- bootstrap p 0.2235 > 0.0167

Профиль short-beta: доля шортов in-sample 99.1%, OOS 98.5% — перекос в шорт заметен (возможная short-beta).

### Per-asset breakdown

| asset | split | n | mean netR | mean excess |
|---|---|---|---|---|
| BTC | in | 37 | -0.0153 | 0.0638 |
| ETH | in | 38 | 0.0182 | 0.0877 |
| SOL | in | 33 | -0.0825 | -0.0091 |
| XRP | in | 41 | -0.0689 | 0.0041 |
| BNB | in | 43 | 0.0196 | 0.1068 |
| DOGE | in | 33 | -0.1366 | -0.0744 |
| 1000PEPE | oos | 34 | 0.0005 | 0.0700 |
| AAVE | oos | 40 | -0.0879 | 0.0029 |
| ARB | oos | 29 | 0.0971 | 0.1329 |
| ENA | oos | 33 | 0.1279 | 0.2080 |
| OP | oos | 31 | 0.0652 | 0.0836 |
| SUI | oos | 36 | -0.0342 | 0.0309 |
