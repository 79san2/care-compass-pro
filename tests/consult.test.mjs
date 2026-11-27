import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consult} from '../engine/consult.mjs';
const evidence={records:[{id:'good',title:'test',url:'https://example.org',summary:'test',verification:'verified',keywords:['소진']},{id:'bad',title:'test',url:'https://example.org',summary:'test',verification:'unverified',keywords:['소진']},{id:'irrelevant',title:'test',url:'https://example.org',summary:'test',verification:'verified',keywords:['바다']}]};
test('two passes and relevant verified evidence only',async()=>{const calls=[];const r=await consult({question:'팀원 소진',evidence,policy:{},generate:async m=>{calls.push(m);return calls.length===1?'초안':'최종';}});assert.equal(calls.length,2);assert.equal(r.answer,'최종');assert.deepEqual(r.evidence.map(e=>e.id),['good']);assert.ok(calls[1][1].content.includes('초안'));});
test('empty question rejected without model call',async()=>{await assert.rejects(consult({question:' ',evidence,policy:{},generate:async()=>assert.fail('unexpected call')}));});
test('empty draft rejected',async()=>{await assert.rejects(consult({question:'소진',evidence,policy:{},generate:async()=>''}));});
test('no unrelated evidence',async()=>{const r=await consult({question:'xyz',evidence,policy:{},generate:async()=> '답변'});assert.equal(r.evidenceCount,0);});
test('review failure not presented as verified answer',async()=>{let n=0;await assert.rejects(consult({question:'소진',evidence,policy:{},generate:async()=>{if(++n===2)throw Error('quota');return '초안';}}));});
