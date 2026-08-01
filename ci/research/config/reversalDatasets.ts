import { loadExactDatasets, type ExactIndicatorDataset } from '../lib/exactIndicatorExport.js'

export interface ChronologicalSlice {
	id: string
	datasetId: string
	kind: 'fit' | 'validation' | 'sealed-test'
	fromIndex: number
	toIndexExclusive: number
}

export function loadReversalDatasets(): ExactIndicatorDataset[] {
	return loadExactDatasets()
}

export function developmentDatasets(datasets = loadReversalDatasets()): ExactIndicatorDataset[] {
	return datasets.filter((dataset) => dataset.meta.role === 'development')
}

export function futuresHoldouts(datasets = loadReversalDatasets()): ExactIndicatorDataset[] {
	return datasets.filter((dataset) => dataset.meta.market === 'futures' && dataset.meta.role !== 'development')
}

export function spotHoldouts(datasets = loadReversalDatasets()): ExactIndicatorDataset[] {
	return datasets.filter((dataset) => dataset.meta.market === 'spot')
}

export function chronologicalSlices(dataset: ExactIndicatorDataset): ChronologicalSlice[] {
	const n = dataset.rows.length
	const fitEnd = Math.floor(n * 0.5)
	const validationEnd = Math.floor(n * 0.75)
	return [
		{ id: `${dataset.meta.id}:fit`, datasetId: dataset.meta.id, kind: 'fit', fromIndex: 0, toIndexExclusive: fitEnd },
		{ id: `${dataset.meta.id}:validation`, datasetId: dataset.meta.id, kind: 'validation', fromIndex: fitEnd, toIndexExclusive: validationEnd },
		{ id: `${dataset.meta.id}:sealed-test`, datasetId: dataset.meta.id, kind: 'sealed-test', fromIndex: validationEnd, toIndexExclusive: n },
	]
}
