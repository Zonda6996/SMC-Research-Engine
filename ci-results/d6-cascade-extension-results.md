# D6 cascade reversion — EXTENSION REVEAL (11 symbol-fresh перпов)

# Вердикт расширения: `GO`

> Конфигурация идентична первому протоколу (ΔOI_8h≤−15% И ΔP_8h≤−3%, LONG next-open, gap 8). Тест = вся история символов, ранее не открывавшихся. Prereg №2 `8ebe6606…`.

События: 194 (по символам: XLM:11, XMR:13, TRX:18, DOT:5, INJ:35, FET:31, 1000BONK:13, CRV:4, PORTAL:15, HBAR:29, ETC:20); без горизонта H24 исключено 0.

## ARM H24 (net % @5bps + funding) — `GO`
- N=194; mean 1.9003%; total 368.65%; PF 1.885; WR 60.8%; maxDD 92.6%.
- **UTC-day cluster CI95: [0.1491%; 3.6260%]**, median 1.9203%.
- Gross@0 mean дескриптивно: 2.0003%.

## ARM CANON (движок safe, netR @5bps + funding) — `KILL`
- N=183; mean 0.0450R; total 8.23R; PF 1.165; WR 64.5%; maxDD 15.4R.
- Исходы: {"full-tp":129,"partial-stop":32,"stop":22}.
- **UTC-day cluster CI95: [-0.0734; 0.1576]R**, median 0.0457R.

## Funding-sign диагностика (в гейты не входит)
- H24: paired delta -1.6414%/opportunity, CI95 [-3.2447; -0.0115], retained N=47, executed mean 1.0684%.
- CANON: paired delta -0.0596R/opportunity, CI95 [-0.1568; 0.0404], retained N=46, executed mean -0.0581R.

## Гейты и терминальность
- GO ⇔ хотя бы одна co-primary рука: N≥100 И lower95>0. После reveal символы сожжены.

## Provenance
- prereg №2 `8ebe66068de7b148166e066d1c316786b7dec64ccc53c51fb3803b7efcd3ef4c`; манифест корпуса `5fa7d805e4d7c237cc110cc9ad30bfbcdd488f59fac7e9df5bc4291ac2725c50`; seed 23082026.