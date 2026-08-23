# Stateful Apex S1 — frozen dataset/split manifest

- Protocol: `apex-state-v1`
- Config SHA-256: `a0b6fab77ef278b1b264beee35c6032fa81241b775b76328b1146980d3fe839e`
- Git commit: `0a5085cacc0f2dfe754ada867c5782504703f2f1` (dirty working tree: true)
- Costs frozen for later labels: 5 bps/side
- Warm-up: 210 bars
- Vendor Shapes: strict parser validates them, then the runner destructures and discards `buy`/`sell` before state detection; they are neither features nor targets.
- Outcomes/metrics: **not computed in this freeze run**. Untouched OOS remains sealed.

## Assignment counts (event-universe only; not performance)

| split | symbols | series | rows | primary events |
|---|---:|---:|---:|---:|
| train | 7 | 27 | 659316 | 5822 |
| validation | 2 | 5 | 99191 | 825 |
| untouched-oos | 3 | 5 | 109294 | 803 |

## Frozen series

| symbol | market | TF | split | rows | eligible | events | no-next-bar | data SHA-256 | file |
|---|---|---|---|---:|---:|---:|---:|---|---|
| ADAUSDT | futures | 15 | train | 22206 | 21996 | 146 | 0 | `afaf4b26155afd0deff9aeb1d8d12d8ada5583748879dff5df5276eccdba1638` | `csv/BINANCE_ADAUSDT.P, 15.csv` |
| ADAUSDT | futures | 45 | train | 30794 | 30584 | 217 | 0 | `fbf6603dad5c26ab32d9e85d3c653e344908ebc19e9e695771567f06cf958809` | `csv/BINANCE_ADAUSDT.P, 45.csv` |
| AVAXUSDT | spot | 5 | untouched-oos | 20609 | 20399 | 179 | 0 | `1b18dc52cabfe9007f3445856ca8b5a9a74880e137e1973906aa708c295e993a` | `csv/BINANCE_AVAXUSDT, 5.csv` |
| AVAXUSDT | futures | 60 | untouched-oos | 23096 | 22886 | 168 | 0 | `63d3716eb8feb891c19786e5c27a989bdae78629c390474904f651098f488dae` | `csv/BINANCE_AVAXUSDT.P, 60.csv` |
| BNBUSDT | spot | 1 | train | 23846 | 23636 | 270 | 0 | `c462e1b7284d77efde79c61e5b2840fd03750376d891019f01712bbb19d98c70` | `csv/BINANCE_BNBUSDT, 1.csv` |
| BNBUSDT | spot | 10S | train | 22032 | 21822 | 306 | 0 | `e1af8f188f57d022893421bc57e17bea3ce86f8ccd853223ef7ab59b34fa0f11` | `csv/BINANCE_BNBUSDT, 10S.csv` |
| BNBUSDT | spot | 1S | train | 30447 | 30237 | 238 | 0 | `1e4fb2ff4331727665ded9e7d63a786b2c93206d660a14c2560d29867381080b` | `csv/BINANCE_BNBUSDT, 1S.csv` |
| BNBUSDT | spot | 5 | train | 20897 | 20687 | 183 | 0 | `c63c562f7150d2f85d926fd1013b84d9ae0f7ef85c5e78a2ef6e9b67e261ccaf` | `csv/BINANCE_BNBUSDT, 5.csv` |
| BNBUSDT | futures | 1 | train | 22178 | 21968 | 240 | 0 | `fb614a573ad450c8c6cbca925c763a3da6a01a1f2062ee004a729dc289ef9f6d` | `csv/BINANCE_BNBUSDT.P, 1.csv` |
| BNBUSDT | futures | 5 | train | 20533 | 20323 | 171 | 0 | `b5c306ec8f6d2985a3eb4c3240c153206df7d37285528a04f6bdf7876539c02d` | `csv/BINANCE_BNBUSDT.P, 5.csv` |
| BTCUSDT | spot | 15 | train | 22205 | 21995 | 175 | 0 | `b711fcbf1ff8e99718f38fd54e2e49d1d47b0f81c00f7b7cba6529b6787be9bb` | `csv/BINANCE_BTCUSDT, 15.csv` |
| BTCUSDT | spot | 5S | train | 26824 | 26614 | 328 | 0 | `ab9f6e28d5114237aa7187dc8016c95b792eb8394ce6592da96edf173b9b940b` | `csv/BINANCE_BTCUSDT, 5S.csv` |
| BTCUSDT | spot | 60 | train | 23096 | 22886 | 177 | 0 | `039a9846a962b3c889a08cb981945844b3b7514adc3761dbc67a28ae47706ab1` | `csv/BINANCE_BTCUSDT, 60.csv` |
| BTCUSDT | futures | 15 | train | 22012 | 21802 | 169 | 0 | `f2ace6c948797e3e601823cd2bc8e08046e64d0531d0b0c2703c6db2d946d71e` | `csv/BINANCE_BTCUSDT.P, 15.csv` |
| BTCUSDT | futures | 5 | train | 20532 | 20322 | 184 | 0 | `fb960a7ffcd0002264e736455e0b46dfc487dddb3cb44600883167602ec479d6` | `csv/BINANCE_BTCUSDT.P, 5.csv` |
| BTCUSDT | futures | 60 | train | 23047 | 22837 | 171 | 0 | `c0559dbd9504051596e14e9de806ad25f1d52d81c17dc9d1130d0961740ed56b` | `csv/BINANCE_BTCUSDT.P, 60.csv` |
| DOGEUSDT | spot | 30 | train | 28623 | 28413 | 218 | 0 | `e900d7c49358d6162e430cdf00065f8c35d646b761bc9e22dab4de100cb77028` | `csv/BINANCE_DOGEUSDT, 30.csv` |
| DOGEUSDT | spot | 45 | train | 30794 | 30584 | 227 | 0 | `d182f7c71c2beb27f7a0a6d51286763d90f0f73eadafc9168e7e56092511af71` | `csv/BINANCE_DOGEUSDT, 45.csv` |
| ETHUSDT | spot | 1 | train | 23844 | 23634 | 274 | 0 | `263ffc43fe129e3b669d88fbafe656b946c8cf584da8bc97a755841d55583e62` | `csv/BINANCE_ETHUSDT, 1.csv` |
| ETHUSDT | spot | 120 | train | 20287 | 20077 | 144 | 0 | `909f4cf589ed3df36d0d91a3bc7febb7063e4a97006696edf78b6770527eb234` | `csv/BINANCE_ETHUSDT, 120.csv` |
| ETHUSDT | spot | 15 | train | 22205 | 21995 | 172 | 0 | `7c2cdb4ae100b0432d0b6d7d209cc87ac26dd5eea916b119de54467f0ac08037` | `csv/BINANCE_ETHUSDT, 15.csv` |
| ETHUSDT | spot | 1S | train | 30205 | 29995 | 316 | 0 | `108f5fe848d5d2bf8dbc8a8915c21ad6f6597b70a2d7a19291409c33e92b6270` | `csv/BINANCE_ETHUSDT, 1S.csv` |
| ETHUSDT | spot | 30 | train | 28623 | 28413 | 236 | 0 | `91b65d8a9090cae1ce446c9c73a6eab4b8959c8985b441a1c0b09aed4d19a5f4` | `csv/BINANCE_ETHUSDT, 30.csv` |
| ETHUSDT | spot | 5 | train | 20897 | 20687 | 186 | 0 | `7f0ee8e723173c31e79dfa8c6b421be306a7c90e6e69231de0d1084328d0c380` | `csv/BINANCE_ETHUSDT, 5.csv` |
| ETHUSDT | spot | 5S | train | 26336 | 26126 | 356 | 0 | `67d58ae6845df8e85b81ebc0055aa88f3029731c8b44ef27dcec5e390e873741` | `csv/BINANCE_ETHUSDT, 5S.csv` |
| LDOUSDT | spot | 15 | train | 22038 | 21828 | 176 | 0 | `3e6312da25dc3b4a640d04f7d9dd72531b600cbfb4f7ebbc6bbb19e339a4edd2` | `csv/BINANCE_LDOUSDT, 15.csv` |
| LDOUSDT | futures | 60 | train | 23096 | 22886 | 171 | 0 | `646fd473ab74f20f57e020d942c4896020242a52cde48122882a3a7947dd3767` | `csv/BINANCE_LDOUSDT.P, 60.csv` |
| LINKUSDT | spot | 15 | untouched-oos | 22206 | 21996 | 144 | 0 | `69bc98b3ccafbd22915b61d33f5d39838cb1948b0b15684d8edc3eadc9ea8608` | `csv/BINANCE_LINKUSDT, 15.csv` |
| LINKUSDT | spot | 60 | untouched-oos | 23096 | 22886 | 162 | 0 | `51d41ef7d5fc2967192db119df269925307119ae105621eca61759b91c851b14` | `csv/BINANCE_LINKUSDT, 60.csv` |
| ONDOUSDT | spot | 5 | validation | 20610 | 20400 | 175 | 0 | `47a5ccd0f401392b46d9e8fdc808ec986d912f7047f07b6a4e080540d4644f86` | `csv/BINANCE_ONDOUSDT, 5.csv` |
| ONDOUSDT | futures | 60 | validation | 22627 | 22417 | 161 | 0 | `021b9da6cfd0e763ae21e4bfda45934965dd2157d561840813269d0d25db602d` | `csv/BINANCE_ONDOUSDT.P, 60.csv` |
| SOLUSDT | spot | 120 | untouched-oos | 20287 | 20077 | 150 | 0 | `4fc2d1653f75638262b4d46d5e2a96371e52f129ff1c05e9ed9dcb6ad97cd4b9` | `csv/BINANCE_SOLUSDT, 120.csv` |
| VIRTUALUSDT | spot | 5 | validation | 20593 | 20383 | 199 | 0 | `d594a408587106baac228180a995d5f0d2e1a35facfbc64b7a9f15a05d73bf76` | `csv/BINANCE_VIRTUALUSDT, 5.csv` |
| VIRTUALUSDT | futures | 5 | validation | 20533 | 20323 | 181 | 0 | `cb3a1524aaa7a5cd282b5f088a44443180292f60b91b562813ba7de600e54fa5` | `csv/BINANCE_VIRTUALUSDT.P, 5.csv` |
| VIRTUALUSDT | futures | 60 | validation | 14828 | 14618 | 109 | 0 | `d80d529fd7165d7036c8884326fdbd1b701aaa1ee1d9424f2efa1cd1d9013a4f` | `csv/BINANCE_VIRTUALUSDT.P, 60.csv` |
| XRPUSDT | spot | 30 | train | 28623 | 28413 | 199 | 0 | `61c2156a3a1a1c224e1ac62b61f591533dcc740d3e62e3597278d59cee448f2a` | `csv/BINANCE_XRPUSDT, 30.csv` |
| XRPUSDT | spot | 60 | train | 23096 | 22886 | 172 | 0 | `780ee097bd7d27f1fc0700588589986e9aab7caeb67215d9d691fbcf4e3c85fd` | `csv/BINANCE_XRPUSDT, 60.csv` |

## Explicit TODO

- `causalRelativeVolume` remains `null`: Track S requires the feature but does not freeze its lookback/denominator. No rule was invented.
- A0/A1 attribution arms are frozen as allowed concepts but are not implemented in this minimal primary runner; no winner selection occurred.

## OOS seal

Untouched-OOS assignments and hashes are visible for reproducibility, but outcome labels, net R, validation decisions, and OOS economic results were not calculated or viewed.
