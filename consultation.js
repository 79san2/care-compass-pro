'use strict';

const workerOrigin = 'https://care-compass-pro.sjsan.workers.dev';
const direct = id => document.getElementById(id);
const accessSlot = 'care-compass-access';
let accessKey = '';
let persistentKey = false;
let pendingQuestion = false;
let activeRequest = null;
const directHistory = [];
try {
  accessKey = localStorage.getItem(accessSlot) || '';
  persistentKey = Boolean(accessKey);
} catch {}

function refreshKeyState() {
  direct('keyState').textContent = !accessKey ? '개인용 키를 한 번 입력하면 다음 자문에도 사용합니다.'
    : persistentKey ? '이 브라우저에 인증키가 저장되어 있습니다.' : '저장 공간을 사용할 수 없어 현재 창에서만 키를 유지합니다.';
  direct('removeKey').hidden = !accessKey;
  direct('accessForm').querySelector('[type="submit"]').textContent = pendingQuestion ? '저장하고 자문 받기' : '인증키 저장';
}
function showKeyForm(forQuestion) {
  pendingQuestion = forQuestion;
  refreshKeyState();
  direct('connectionSettings').open = true;
  direct('personalKey').focus();
}
function removeKey() {
  accessKey = '';
  persistentKey = false;
  try { localStorage.removeItem(accessSlot); } catch {}
  direct('personalKey').value = '';
  refreshKeyState();
}
function cancelRequest() {
  activeRequest?.abort();
  activeRequest = null;
  direct('askButton').disabled = false;
}
function clearDirect() {
  cancelRequest();
  window.consultationVoice?.stop();
  if (direct('voiceStatus')) direct('voiceStatus').textContent = '';
  setConversationMode(false);
  pendingQuestion = false;
  refreshKeyState();
  directHistory.length = 0;
  direct('directChat').replaceChildren();
  direct('directQuestion').value = '';
  direct('directStatus').textContent = '새 대화를 시작하세요.';
  direct('alternate').hidden = true;
}

direct('accessForm').addEventListener('submit', event => {
  event.preventDefault();
  const value = direct('personalKey').value.trim();
  if (!value) { direct('keyState').textContent = '저장할 인증키를 입력해 주세요.'; return; }
  cancelRequest();
  accessKey = value;
  try { localStorage.setItem(accessSlot, value); persistentKey = true; } catch { persistentKey = false; }
  direct('personalKey').value = '';
  const shouldSend = pendingQuestion;
  pendingQuestion = false;
  refreshKeyState();
  direct('connectionSettings').open = false;
  direct('directStatus').textContent = direct('keyState').textContent;
  if (shouldSend) askDirect();
});
direct('removeKey').addEventListener('click', () => {
  cancelRequest();
  pendingQuestion = false;
  removeKey();
  direct('directStatus').textContent = '인증키를 삭제했습니다.';
});
refreshKeyState();
direct('directStatus').textContent = accessKey ? direct('keyState').textContent : '첫 자문 때 개인용 인증키를 연결해 주세요.';

function offerDirectSite() {
  direct('alternate').hidden = location.origin === workerOrigin;
}

function authorization(key) {
  if (/^[\x20-\x7e]+$/.test(key)) return 'Bearer ' + key;
  const bytes = new TextEncoder().encode(key);
  return 'Compass-UTF8 ' + btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
}

async function checkServer(signal) {
  const response = await fetch(workerOrigin + '/api/status', { signal, cache: 'no-store', credentials: 'omit' });
  const data = await response.json().catch(() => null);
  return { connected: data?.service === 'care-compass', ready: response.ok && data?.ready, status: response.status };
}

direct('checkConnection').addEventListener('click', async () => {
  const button = direct('checkConnection');
  const state = direct('connectionState');
  button.disabled = true;
  state.textContent = '서버와 연결하는 중…';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const check = await checkServer(controller.signal);
    if (check.connected) {
      state.textContent = check.ready ? '서버 연결 및 자문 설정 확인. 실제 답변은 자문 요청 후 확인할 수 있습니다.'
        : '서버에 연결되었습니다. 운영 설정을 확인해야 합니다.';
    } else {
      state.textContent = '연결 확인용 응답을 받지 못했습니다 (HTTP ' + check.status + ').';
    }
  } catch {
    state.textContent = controller.signal.aborted ? '연결 확인 시간이 초과되었습니다.' : '이 주소에서 서버에 연결할 수 없습니다.';
    offerDirectSite();
  } finally {
    clearTimeout(timer);
    button.disabled = false;
  }
});

async function readConsultation(response, onStage) {
  if (!response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
    const body = await response.text();
    let data = null;
    try { data = JSON.parse(body); } catch {}
    return { status: response.status, data };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      if (done && buffer) lines.push(buffer);
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (Number.isInteger(event?.status) && event.data) return event;
        if (event?.stage === 'draft' || event?.stage === 'review') onStage(event.stage);
      }
      if (done) throw Error('Incomplete consultation response');
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function selectLocalReferences(question) {
  try {
    const rows = JSON.parse(localStorage.getItem('care-compass-research-v1') || '[]');
    const stopWords = new Set(['어떻게','있어요','있습니다','합니다','하는','대한','관련']);
    const words = [...new Set(question.toLowerCase().match(/[가-힣a-z0-9]{2,}/g) || [])]
      .filter(word => !stopWords.has(word)).slice(0, 40);
    return rows.filter(row => typeof row?.summary === 'string' && typeof row.title === 'string')
      .flatMap(row => (row.summary.match(/[\s\S]{1,1200}/g) || []).map(excerpt => ({
        title: row.title.slice(0, 200), excerpt,
        score: words.filter(word => (row.title + ' ' + excerpt).toLowerCase().includes(word)).length,
      }))).filter(row => row.score >= 2).sort((a, b) => b.score - a.score).slice(0, 2)
      .map(({ title, excerpt }) => ({ title, excerpt }));
  } catch { return []; }
}

function node(tag, text) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  return element;
}

function citedSources(data) {
  const candidates = Array.isArray(data.evidence) ? data.evidence : [];
  const ids = Array.isArray(data.citedEvidenceIds) ? data.citedEvidenceIds
    : candidates.filter(ref => data.answer.includes('[근거:' + ref.id + ']')).map(ref => ref.id);
  const sources = new Map();
  for (const id of new Set(ids)) {
    const ref = candidates.find(item => item.id === id);
    if (!ref) continue;
    try {
      const url = new URL(ref.url);
      if (url.protocol === 'https:') sources.set(id, { title: ref.title || url.hostname, href: url.href, number: sources.size + 1 });
    } catch {}
  }
  return sources;
}

function sourceLink(ref, label) {
  const link = node('a', label);
  link.href = ref.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', '근거 ' + ref.number + '. ' + ref.title + ' (새 창)');
  return link;
}

function writeInline(parent, text, sources) {
  const tokens = text.split(/(\*\*[^*\n]+\*\*|\[\s*근거\s*[:：][^\]\n]+\])/gu);
  for (const token of tokens) {
    if (token.startsWith('**') && token.endsWith('**')) {
      const strong = node('strong');
      writeInline(strong, token.slice(2, -2), sources);
      parent.append(strong);
      continue;
    }
    const citation = token.match(/^\[\s*근거\s*[:：]([^\]]+)\]$/u);
    const refs = citation?.[1].split(/[,，]/u).map(id => sources.get(id.trim()));
    if (refs?.length && refs.every(Boolean)) {
      for (const ref of refs) parent.append(sourceLink(ref, '[' + ref.number + ']'));
    } else {
      parent.append(document.createTextNode(token));
    }
  }
}

function renderAnswer(answer, sources) {
  const body = node('div');
  body.className = 'answer-body';
  let group = body;
  let list = null;
  for (const raw of answer.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const plain = line.replace(/\*\*/g, '').replace(/[:：]\s*$/, '');
    const heading = plain.match(/^#{1,6}\s+(.+)/)?.[1]
      || plain.match(/^(?:\d+[.)]\s*)?(핵심 자문|오늘 해볼 지원|이어서 확인할 점|자세히 보기|근거와 적용 한계)$/)?.[1];
    if (heading) {
      list = null;
      if (/^(자세히 보기|근거와 적용 한계)$/.test(heading)) {
        group = node('details');
        group.append(node('summary', heading));
      } else {
        group = node('div');
        if (heading === '이어서 확인할 점') group.className = 'next-question';
        group.append(node('h3', heading));
      }
      body.append(group);
      continue;
    }
    const bullet = line.match(/^([-*•]|\d+[.)])\s+(.+)$/u);
    if (bullet) {
      const ordered = /^\d/.test(bullet[1]);
      const tag = ordered ? 'ol' : 'ul';
      if (!list || list.localName !== tag) {
        list = node(tag);
        if (ordered) list.start = parseInt(bullet[1], 10);
        group.append(list);
      }
      const item = node('li');
      writeInline(item, bullet[2], sources);
      list.append(item);
    } else {
      list = null;
      const p = node('p');
      writeInline(p, line, sources);
      group.append(p);
    }
  }
  return body;
}

function setConversationMode(ongoing) {
  const heading = direct('conversationHeading');
  if (heading) {
    heading.textContent = ongoing ? '자문 대화' : '어떤 어려움이 있으신가요?';
    direct('conversationIntro').hidden = ongoing;
    direct('followPrompts').hidden = !ongoing;
    direct('questionLabel').textContent = ongoing ? '이어서 이야기하기' : '고민 또는 추가 질문';
  }
  direct('directQuestion').placeholder = ongoing ? '답하거나 더 궁금한 점을 적어 주세요.' : '지원 과정에서 겪고 있는 어려움을 이야기해 주세요.';
  direct('askButton').textContent = ongoing ? '후속 질문 보내기' : '전문자문 받기';
}

direct('followPrompts')?.addEventListener('click', event => {
  const button = event.target.closest('button[data-prompt]');
  if (!button) return;
  const input = direct('directQuestion');
  const text = input.value.trimEnd();
  if (!text.endsWith(button.dataset.prompt)) {
    const joined = text ? text + '\n' + button.dataset.prompt : button.dataset.prompt;
    if (joined.length <= input.maxLength) input.value = joined;
  }
  input.focus();
});

function appendAnswer(question, data) {
  const turn = node('article');
  turn.className = 'consult-turn';
  const user = node('p', question);
  user.className = 'chatmsg user';
  const sources = citedSources(data);
  const answerBody = renderAnswer(data.answer, sources);
  turn.append(user, answerBody);
  const refs = [...sources.values()];
  if (refs.length) {
    const details = node('details');
    details.className = 'turn-sources';
    details.append(node('summary', '인용한 자료 ' + refs.length + '건'));
    for (const ref of refs) details.append(sourceLink(ref, '[' + ref.number + '] ' + ref.title));
    turn.append(details);
  }
  const links = [...sources].map(([id, ref]) => '[' + id + '] ' + ref.title + ' — ' + ref.href);
  const text = [data.answer, ...links].join('\n\n');
  const actions = node('div');
  actions.className = 'turn-actions';
  const read = window.consultationVoice?.readButton(data.answer);
  if (read) actions.append(read);
  for (const label of ['자문 복사', '자문 공유']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.onclick = async () => {
      if (!confirm('공유할 자문에 개인정보나 민감한 내용이 없는지 확인하셨나요?')) return;
      try {
        if (label === '자문 공유' && navigator.share) await navigator.share({ title: '돌봄나침반 PRO 전문자문', text });
        else { await navigator.clipboard.writeText(text); direct('directStatus').textContent = '자문 복사 완료'; }
      } catch (error) {
        if (error.name !== 'AbortError') direct('directStatus').textContent = '답변을 직접 선택해 복사해 주세요.';
      }
    };
    actions.append(button);
  }
  turn.append(actions);
  direct('directChat').append(turn);
  setConversationMode(true);
  if (location.hash !== '#register' && direct('directQuestion').value.trim() === question) {
    turn.scrollIntoView({ block: 'start' });
  }
}

async function askDirect() {
  if (window.consultationVoice?.finishDictation()) {
    direct('directStatus').textContent = '음성 입력을 마친 뒤 옮겨진 내용을 확인하고 보내 주세요.';
    return;
  }
  window.consultationVoice?.stop();
  const input = direct('directQuestion');
  const question = input.value.trim();
  const status = direct('directStatus');
  if (activeRequest) return;
  if (!question || question.length > 4000) {
    status.textContent = '고민을 1~4,000자로 입력해 주세요.';
    input.focus();
    return;
  }
  if (!accessKey) {
    status.textContent = '개인용 인증키를 입력하면 작성한 질문으로 자문을 시작합니다.';
    showKeyForm(true);
    return;
  }
  const candidates = selectLocalReferences(question);
  const localReferences = candidates.length && confirm('관련 등록 자료 일부를 자문 서버로 전송할까요? 공개자료이며 개인정보가 없는 경우에만 동의하세요. 취소해도 일반 자문은 진행됩니다.') ? candidates : [];
  // Keep the original concern when a conversation extends beyond three exchanges.
  const recent = directHistory.length <= 6 ? directHistory : [directHistory[0], ...directHistory.slice(-4)];
  const history = recent.map(({ role, content }) => ({
    role, content: content.length <= 2000 ? content : content.slice(0, 1450) + '\n…\n' + content.slice(-540),
  }));
  const controller = new AbortController();
  activeRequest = controller;
  if (direct('voiceStatus')) direct('voiceStatus').textContent = '';
  direct('askButton').disabled = true;
  direct('alternate').hidden = true;
  status.textContent = '자문 서버에 질문을 보내고 있습니다…';
  let timer;
  let stage = '';
  const stageLabels = { draft: '자문 초안 작성', review: '근거와 답변 검토' };
  function startTimer() {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), 180000);
  }
  startTimer();
  let receivedHeaders = false;
  try {
    const response = await fetch(workerOrigin + '/api/consult', {
      method: 'POST', credentials: 'omit', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', Authorization: authorization(accessKey) },
      body: JSON.stringify({ question, history, localReferences }),
    });
    if (activeRequest !== controller) return;
    receivedHeaders = true;
    if (response.status === 401) {
      pendingQuestion = true;
      status.textContent = '서버가 현재 인증키를 거절했습니다 (HTTP 401). 질문은 그대로 있습니다. 인증키를 확인해 주세요.';
      showKeyForm(true);
      return;
    }
    const result = await readConsultation(response, nextStage => {
      if (activeRequest !== controller || stage === nextStage) return;
      stage = nextStage;
      status.textContent = '질문이 접수되었습니다. ' + stageLabels[stage] + ' 중…';
      startTimer();
    });
    const { data } = result;
    if (activeRequest !== controller) return;
    if (result.status !== 200) {
      const hints = { 400:'질문 형식을 확인해 주세요.', 403:'서버가 이 주소의 접근을 허용하지 않았습니다.',
        413:'질문 길이를 줄여 주세요.', 429:'사용량 한도에 도달했습니다. 잠시 후 이용해 주세요.',
        503:'서버의 자문 설정을 확인해야 합니다.' };
      const codes = ['MODEL_OUTPUT','EVIDENCE_CHECK','SERVER_GENERATION','SERVER_AUTH','USAGE_LIMIT'];
      const code = codes.includes(data?.code) ? ' · ' + data.code : '';
      status.textContent = (hints[result.status] || '서버에서 자문을 완료하지 못했습니다.') + ' (' + (stage ? stageLabels[stage] + ' · ' : '') + result.status + code + ')';
      if (result.status === 403) offerDirectSite();
      return;
    }
    if (!data || typeof data.answer !== 'string' || !data.answer.trim()) {
      status.textContent = '서버에 연결됐지만 읽을 수 있는 답변이 없습니다 (응답 형식). 질문을 유지했습니다.';
      return;
    }
    appendAnswer(question, data);
    directHistory.push({ role:'user', content:question }, { role:'assistant', content:data.answer });
    if (input.value.trim() === question) input.value = '';
    status.textContent = '자문 답변 완료';
  } catch {
    if (activeRequest !== controller) return;
    const point = stageLabels[stage] || (receivedHeaders ? '답변 수신' : '접수 확인');
    if (controller.signal.aborted) {
      status.textContent = point + ' 대기 시간이 초과되었습니다. 질문과 인증키는 그대로 있습니다.';
    } else if (receivedHeaders) {
      status.textContent = point + ' 중 응답이 끊겼습니다. 질문과 인증키는 그대로 있습니다.';
    } else {
      status.textContent = '질문 접수 여부를 확인할 수 없어 서버 연결을 점검하고 있습니다…';
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), 8000);
      const check = await checkServer(controller.signal).catch(() => null);
      if (activeRequest !== controller) return;
      const detail = check?.connected ? '서버 연결은 확인됐지만 질문 접수 응답을 받지 못했습니다.'
        : '이 기기에서 서버 상태와 질문 접수 여부를 확인할 수 없습니다.';
      status.textContent = detail + ' 질문과 인증키는 그대로 있습니다.';
    }
    offerDirectSite();
  } finally {
    clearTimeout(timer);
    if (activeRequest === controller) {
      activeRequest = null;
      direct('askButton').disabled = false;
    }
  }
}
