import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectDuplicate} from '../knowledge/dedup.mjs';
test('same file with different name is blocked',()=>assert.equal(inspectDuplicate({title:'new',sha256:'abc'},[{id:'a',title:'old',sha256:'abc'}])[0].action,'block'));
test('tracking URL variants are detected',()=>assert.ok(inspectDuplicate({url:'https://example.org/a?utm_source=x'},[{id:'a',url:'https://example.org/a'}])[0].reasons.includes('same-url')));
test('same DOI is flagged',()=>assert.ok(inspectDuplicate({doi:'10.1234/ABC'},[{id:'a',url:'https://doi.org/10.1234/abc'}])[0].reasons.includes('same-doi')));
test('similar text is reviewed rather than deleted',()=>assert.equal(inspectDuplicate({summary:'긍정적 행동지원은 개인의 선택과 환경을 고려하여 지원한다'},[{id:'a',summary:'긍정적 행동지원은 개인의 선택과 환경을 고려하여 지원한다'}])[0].action,'review'));
test('unrelated records are not flagged',()=>assert.deepEqual(inspectDuplicate({title:'음악',summary:'악기 연주'},[{id:'a',title:'수면',summary:'건강 관리'}]),[]));
