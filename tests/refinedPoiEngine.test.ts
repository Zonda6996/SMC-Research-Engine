import assert from 'node:assert/strict'
import { it } from 'node:test'
import { REFINED_POI_VERSION, detectRefinedPoi } from '../src/core/confirmation/RefinedPoiEngine.js'

it('refined POI engine has frozen mechanical research version',()=>{
 assert.equal(REFINED_POI_VERSION,'refined-poi-0.2-ob-confirmed-fvg')
 assert.deepEqual(detectRefinedPoi([],[],[]),[])
})
