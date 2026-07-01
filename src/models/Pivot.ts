// Pivot.ts

export interface Pivot {
	index: number

	timestamp: number

	price: number

	type: 'high' | 'low'
}
