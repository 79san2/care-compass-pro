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

direct('checkConnection').addEventListener('click', async () => {
  const button = direct('checkConnection');
  const state = direct('connectionState');
  button.disabled = true;
  state.textContent = '서버와 연결하는 중…';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(workerOrigin + '/api/status', { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    const data = await response.json().catch(() => null);
    if (data?.service === 'care-compass') {
      state.textContent = response.ok && data.ready ? '서버 연결 및 자문 설정 확인. 실제 답변은 자문 요청 후 확인할 수 있습니다.'
        : '서버에 연결되었습니다. 운영 설정을 확인해야 합니다.';
    } else {
      state.textContent = '연결 확인용 응답을 받지 못했습니다 (HTTP ' + response.status + ').';
    }
  } catch {
    state.textContent = controller.signal.aborted ? '연결 확인 시간이 초과되었습니다.' : '이 주소에서 서버에 연결할 수 없습니다.';
    offerDirectSite();
  } finally {
    clearTimeout(timer);
    button.disabled = false;
  }
});

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

function appendAnswer(question, data) {
  const log = direct('directChat');
  for (const [kind, value] of [['user', question], ['assistant', data.answer]]) {
    const node = document.createElement('div');
    node.className = 'chatmsg ' + kind;
    node.textContent = value;
    log.append(node);
  }
  const sources = [];
  for (const ref of Array.isArray(data.evidence) ? data.evidence : []) {
    try {
      const url = new URL(ref.url);
      if (url.protocol !== 'https:') continue;
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = ref.title || url.hostname;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      log.append(link);
      sources.push(link.textContent + ' — ' + url.href);
    } catch {}
  }
  const text = [data.answer, sources.length ? '참고자료\n' + sources.join('\n') : ''].filter(Boolean).join('\n\n');
  const actions = document.createElement('div');
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
  log.append(actions);
}

async function askDirect() {
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
  const history = directHistory.slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, 2000) }));
  const controller = new AbortController();
  activeRequest = controller;
  direct('askButton').disabled = true;
  direct('alternate').hidden = true;
  status.textContent = '자문을 작성하고 근거를 검토하고 있습니다…';
  const timer = setTimeout(() => controller.abort(), 180000);
  let receivedHeaders = false;
  try {
    const response = await fetch(workerOrigin + '/api/consult', {
      method: 'POST', credentials: 'omit', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessKey },
      body: JSON.stringify({ question, history, localReferences }),
    });
    if (activeRequest !== controller) return;
    receivedHeaders = true;
    if (response.status === 401) {
      pendingQuestion = true;
      removeKey();
      status.textContent = '서버가 인증키를 거절했습니다. 키를 다시 입력해 주세요.';
      showKeyForm(true);
      return;
    }
    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch {}
    if (activeRequest !== controller) return;
    if (!response.ok) {
      const hints = { 400:'질문 형식을 확인해 주세요.', 403:'서버가 이 주소의 접근을 허용하지 않았습니다.',
        413:'질문 길이를 줄여 주세요.', 429:'사용량 한도에 도달했습니다. 잠시 후 이용해 주세요.',
        503:'서버의 자문 설정을 확인해야 합니다.' };
      const codes = ['MODEL_OUTPUT','EVIDENCE_CHECK','SERVER_GENERATION','SERVER_AUTH','USAGE_LIMIT'];
      const code = codes.includes(data?.code) ? ' · ' + data.code : '';
      status.textContent = (hints[response.status] || '서버에서 자문을 완료하지 못했습니다.') + ' (HTTP ' + response.status + code + ')';
      if (response.status === 403) offerDirectSite();
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
    status.textContent = controller.signal.aborted ? '응답을 기다리는 시간이 초과되었습니다. 질문을 유지했습니다.'
      : receivedHeaders ? '서버 응답을 끝까지 읽지 못했습니다. 질문을 유지했습니다.'
      : '자문 서버에 연결할 수 없습니다. 질문과 인증키를 유지했습니다.';
    offerDirectSite();
  } finally {
    clearTimeout(timer);
    if (activeRequest === controller) {
      activeRequest = null;
      direct('askButton').disabled = false;
    }
  }
}
