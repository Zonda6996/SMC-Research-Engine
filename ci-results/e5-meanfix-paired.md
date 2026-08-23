# E5 — Mean-fix paired-arm (pd_premium), before/after по ТФ

EXPLORATORY. Форк E3-протокола (NET 7bps/сторона, 5 фиксов, плацебо K=20 ±30дн same symbol+side,
cluster-bootstrap 2000, seed 20260807). Нога: pd_premium (D3, relVol 1.4, premium-4h).
BASE = partial 25% у mean + static TP. MEANFIX = полная фиксация у mean. Стоп 12×TR55, timestop общий (BASE-калибровка).

**Result R** = Σ netR по сделкам сплита; **Result %** = Σ net% (P&L в % цены). **excess** = netR − mean(плацебо) — метрика kill.
Kill (per arm): excess < +0.05R (in), ИЛИ p > 0.0167, ИЛИ excess < 0 (OOS).

## ТФ 5m (timestop=117 bars; in=BTC,ETH,SOL,XRP,BNB,DOGE; oos=1000PEPE,AAVE,ARB,ENA,OP,SUI)

| ТФ | arm | split | n | End-mark | Result R | Result % | mean netR | mean excess | p | short-share |
|---|---|---|---|---|---|---|---|---|---|---|
| 5m | BASE | IN | 204 | 49.0% | -8.49R | -12.26% | -0.0416 | 0.0686 | 0.1215 | 75.0% |
| 5m | BASE | OOS | 174 | 66.7% | -0.01R | +7.48% | -0.0000 | 0.0749 | 0.0500 | 76.4% |
| 5m | MEANFIX | IN | 204 | 1.0% | -22.73R | -34.04% | -0.1114 | 0.0687 | 0.0515 | 75.0% |
| 5m | MEANFIX | OOS | 174 | 1.1% | -2.40R | +0.63% | -0.0138 | 0.1191 | 0.0000 | 76.4% |

- **BASE: ❌ KILLED** — bootstrap p 0.1215 > 0.0167
- **MEANFIX: ❌ KILLED** — bootstrap p 0.0515 > 0.0167

## ТФ 15m (timestop=156 bars; in=BTC,ETH,SOL,XRP,BNB,DOGE; oos=1000PEPE,ARB,OP,SUI)

| ТФ | arm | split | n | End-mark | Result R | Result % | mean netR | mean excess | p | short-share |
|---|---|---|---|---|---|---|---|---|---|---|
| 15m | BASE | IN | 204 | 51.0% | -6.94R | -23.03% | -0.0340 | 0.0432 | 0.2065 | 94.1% |
| 15m | BASE | OOS | 118 | 46.6% | -4.99R | -42.15% | -0.0423 | -0.0184 | 0.6100 | 95.8% |
| 15m | MEANFIX | IN | 204 | 0.0% | -2.39R | -18.82% | -0.0117 | 0.1289 | 0.0000 | 94.1% |
| 15m | MEANFIX | OOS | 118 | 0.0% | -8.37R | -57.07% | -0.0710 | 0.0544 | 0.1575 | 95.8% |

- **BASE: ❌ KILLED** — in-sample excess 0.0432R < +0.05R; bootstrap p 0.2065 > 0.0167; OOS excess -0.0184R < 0
- **MEANFIX: ✅ SURVIVES**

## ТФ 30m (timestop=141 bars; in=BTC,ETH,SOL,XRP,BNB,DOGE; oos=1000PEPE,AAVE,ARB,ENA,OP,SUI)

| ТФ | arm | split | n | End-mark | Result R | Result % | mean netR | mean excess | p | short-share |
|---|---|---|---|---|---|---|---|---|---|---|
| 30m | BASE | IN | 221 | 50.7% | -4.64R | +9.48% | -0.0210 | 0.0374 | 0.2405 | 99.1% |
| 30m | BASE | OOS | 213 | 48.8% | +8.92R | +181.19% | 0.0419 | 0.0834 | 0.0495 | 98.6% |
| 30m | MEANFIX | IN | 221 | 0.0% | -12.29R | -64.23% | -0.0556 | 0.0775 | 0.0220 | 99.1% |
| 30m | MEANFIX | OOS | 213 | 0.5% | -9.37R | -45.23% | -0.0440 | 0.0820 | 0.0205 | 98.6% |

- **BASE: ❌ KILLED** — in-sample excess 0.0374R < +0.05R; bootstrap p 0.2405 > 0.0167
- **MEANFIX: ❌ KILLED** — bootstrap p 0.0220 > 0.0167

## ТФ 1h (timestop=147 bars; in=BTC,ETH,SOL,XRP,BNB,DOGE; oos=1000PEPE,AAVE,ARB,ENA,OP,SUI)

| ТФ | arm | split | n | End-mark | Result R | Result % | mean netR | mean excess | p | short-share |
|---|---|---|---|---|---|---|---|---|---|---|
| 1h | BASE | IN | 225 | 50.7% | -9.08R | -115.26% | -0.0404 | 0.0293 | 0.2545 | 99.1% |
| 1h | BASE | OOS | 203 | 51.2% | +4.33R | +45.00% | 0.0213 | 0.0784 | 0.0590 | 98.5% |
| 1h | MEANFIX | IN | 225 | 0.0% | -11.84R | -155.90% | -0.0526 | 0.0672 | 0.0185 | 99.1% |
| 1h | MEANFIX | OOS | 203 | 0.0% | -1.65R | -30.43% | -0.0081 | 0.1105 | 0.0000 | 98.5% |

- **BASE: ❌ KILLED** — in-sample excess 0.0293R < +0.05R; bootstrap p 0.2545 > 0.0167
- **MEANFIX: ❌ KILLED** — bootstrap p 0.0185 > 0.0167
