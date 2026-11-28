import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consult} from '../engine/consult.mjs';
const evidence={records:[{id:'good',title:'test',url:'https://example.org',summary:'test',verification:'verified',verificationGrade:'B',keywords:['소진']},{id:'bad',title:'test',url:'https://example.org',summary:'test',verification:'unverified',keywords:['소진']},{id:'irrelevant',title:'test',url:'https://example.org',summary:'test',verification:'verified',verificationGrade:'B',keywords:['바다']}]};
test('two passes and relevant verified evidence only',async()=>{const calls=[];const r=await consult({question:'팀원 소진',evidence,policy:{},generate:async m=>{calls.push(m);return calls.length===1?'초안':'최종';}});assert.equal(calls.length,2);assert.equal(r.answer,'최종');assert.deepEqual(r.evidence.map(e=>e.id),['good']);assert.ok(calls[1][1].content.includes('초안'));});
test('empty question rejected without model call',async()=>{await assert.rejects(consult({question:' ',evidence,policy:{},generate:async()=>assert.fail('unexpected call')}));});
test('empty draft rejected',async()=>{await assert.rejects(consult({question:'소진',evidence,policy:{},generate:async()=>''}));});
test('no unrelated evidence',async()=>{const r=await consult({question:'xyz',evidence,policy:{},generate:async()=> '답변'});assert.equal(r.evidenceCount,0);});
test('review failure not presented as verified answer',async()=>{let n=0;await assert.rejects(consult({question:'소진',evidence,policy:{},generate:async()=>{if(++n===2)throw Error('quota');return '초안';}}));});

test('legacy verification without grade excluded',async()=>{const r=await consult({question:'소진',evidence:{records:[{...evidence.records[0],verificationGrade:undefined}]},policy:{},generate:async()=> '답변'});assert.equal(r.evidenceCount,0);});
test('unknown structured citation rejected',async()=>{await assert.rejects(consult({question:'소진',evidence,policy:{},generate:async()=> '답변 [근거:invented]'}),/Unknown evidence/);});
test('known structured citation accepted',async()=>{const r=await consult({question:'소진',evidence,policy:{},generate:async()=> '답변 [근거:good]'});assert.equal(r.evidenceCount,1);});

test('candidates without a citation are not presented as cited sources', async () => {
  const result = await consult({question:'소진', evidence, policy:{}, generate:async () => '관찰 질문'});
  assert.equal(result.evidenceCount, 1);
  assert.deepEqual(result.citedEvidenceIds, []);
});

test('citations accept spacing and list each cited source once in first-use order', async () => {
  const records = ['first', 'second', 'unused'].map(id => ({...evidence.records[0], id}));
  const answer = '설명 [근거 ： second, first] 보충 [근거:first]';
  const result = await consult({question:'소진', evidence:{records}, policy:{}, generate:async () => answer});
  assert.deepEqual(result.citedEvidenceIds, ['second','first']);
});

test('unlisted IDs cannot pass as spaced or grouped citations', async () => {
  for (const answer of ['[근거 : unknown]', '[ 근거: unknown]', '[근거： good, unknown]', '[근거:good, unknown]']) {
    await assert.rejects(consult({question:'소진', evidence, policy:{}, generate:async () => answer}), /Unknown evidence/);
  }
});

test('follow-up drafting and review both receive the conversation and follow-up instructions', async () => {
  const history = [{role: 'user', content: '팀원 소진'}, {role: 'assistant', content: '어느 시간대가 가장 힘든가요?'}];
  const calls = [];
  await consult({question: '오후입니다.', history, evidence, policy: {}, generate: async messages => {
    calls.push(messages);
    return '모의 응답';
  }});
  for (const [system, input] of calls) {
    assert.match(system.content, /이번에는 후속 대화다/);
    assert.deepEqual(JSON.parse(input.content).history, history);
    assert.equal(JSON.parse(input.content).question, '오후입니다.');
  }
});
