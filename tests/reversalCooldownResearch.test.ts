import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectReversalCooldown, type ReversalCooldownConfig } from '../src/core/signals/ReversalCooldownResearch.js'
import type { ReversalResearchRow } from '../src/core/signals/ReversalStateMachineResearch.js'

const config: ReversalCooldownConfig = { candidate: 'inner-recovery-directional', cooldownBars: 50, warmupBars: 0, minDistance: 0.4, maxDistance: 0.9, minRecoveryDelta: 0.1, innerMemoryBars: 100 }
const row = (timestamp:number,open:number,close:number,low=Math.min(open,close)-1,high=Math.max(open,close)+1):ReversalResearchRow=>({timestamp,open,high,low,close,volume:1,mean:100,upperInner:110,lowerInner:90,upperOuter:115,lowerOuter:85})

it('Reversal cooldown: first eligible recovery emits and global cooldown suppresses nearby signals',()=>{
	const rows=[row(0,100,100),row(1,91,88,87),row(2,88,89),row(3,89,93),row(4,109,112,111,113),row(5,112,107)]
	const signals=detectReversalCooldown(rows,config)
	assert.equal(signals.length,1)
	assert.equal(signals[0]!.direction,'long')
})

it('Reversal cooldown: prefix invariance',()=>{
	const prefix=Array.from({length:100},(_,i)=>row(i,100+10*Math.sin((i-1)/10),100+10*Math.sin(i/10)))
	const before=detectReversalCooldown(prefix,config)
	const after=detectReversalCooldown([...prefix,...Array.from({length:30},(_,i)=>row(100+i,130-i,129-i))],config).filter(x=>x.index<prefix.length)
	assert.deepEqual(after,before)
})
