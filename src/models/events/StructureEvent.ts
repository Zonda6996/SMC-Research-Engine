// StructureEvent.ts
//
// Событие слома структуры (BOS / CHoCH), производимое BosChochEngine.
// Единственный формат событий структуры для пайплайна и стратегий.

export type StructureEventType = 'bos' | 'choch' | 'unlabeled'

export interface StructureEvent {
	/** BOS — слом по направлению, CHoCH — против, unlabeled — первому событию не с чем сравнивать. */
	type: StructureEventType
	/** Направление слома: пробой high = 'up', пробой low = 'down'. */
	direction: 'up' | 'down'
	/** Цена пробитого уровня. */
	levelPrice: number
	/** Тип пробитого экстремума. */
	levelType: 'high' | 'low'
	/** Индекс свечи, на которой возник уровень. */
	levelIndex: number
	/** Структурная метка уровня (HH/HL/LH/LL/UNKNOWN). */
	levelLabel: string
	/** Свеча первого закрытия за уровнем. */
	breachIndex: number
	breachTimestamp: number
	/** Свеча подтверждения слома (в two-candle режиме — вторая). */
	confirmIndex: number
	confirmTimestamp: number
	/** true = до слома у уровня уже снимали ликвидность фитилём. */
	sweptBefore: boolean
	/** Максимальная глубина прокола фитилём до слома (цена), 0 = не снимали. */
	sweptDepth: number
}
