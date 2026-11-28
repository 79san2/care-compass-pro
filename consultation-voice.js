'use strict';

window.consultationVoice = (() => {
  const mic = document.getElementById('voiceInput');
  const input = document.getElementById('directQuestion');
  const note = document.getElementById('voiceNote');
  const status = document.getElementById('voiceStatus');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let listening = null;
  let playback = null;

  function stopReading() {
    if (!playback) return;
    const { button } = playback;
    playback = null;
    window.speechSynthesis.cancel();
    button.textContent = '답변 듣기';
    button.setAttribute('aria-pressed', 'false');
  }

  function finishListening() {
    listening = null;
    mic.textContent = '음성 입력';
    mic.setAttribute('aria-pressed', 'false');
  }

  function cancelListening() {
    if (!listening) return;
    const active = listening;
    finishListening();
    active.abort();
    status.textContent = '';
  }

  function startListening() {
    if (listening) {
      listening.stop();
      return;
    }
    stopReading();
    try {
      const rec = new Recognition();
      rec.lang = 'ko-KR';
      rec.continuous = false;
      rec.interimResults = false;
      const inserted = new Set();
      rec.onresult = event => {
        if (listening !== rec) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result.isFinal || inserted.has(i)) continue;
          inserted.add(i);
          const words = result[0].transcript.trim();
          if (!words) continue;
          const joined = input.value + (input.value && !/\s$/.test(input.value) ? ' ' : '') + words;
          input.value = joined.slice(0, input.maxLength);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          status.textContent = joined.length > input.maxLength ? '입력 한도까지 옮겼습니다. 내용을 확인해 주세요.'
            : '말씀을 글로 옮겼습니다. 내용을 확인하고 보내 주세요.';
        }
      };
      rec.onerror = event => {
        if (listening !== rec) return;
        const messages = {
          'not-allowed': '마이크 사용 권한을 확인하거나 글로 입력해 주세요.',
          'service-not-allowed': '음성 인식 서비스를 사용할 수 없습니다. 글로 입력해 주세요.',
          'no-speech': '음성이 들리지 않았습니다. 음성 입력을 다시 눌러 주세요.',
          'audio-capture': '마이크를 사용할 수 없습니다. 키보드로 입력해 주세요.',
        };
        status.textContent = messages[event.error] || '음성 입력이 중단되었습니다. 다시 시도하거나 글로 입력해 주세요.';
        finishListening();
      };
      rec.onend = () => {
        if (listening !== rec) return;
        if (!inserted.size) status.textContent = '음성 입력을 마쳤습니다. 글로 입력하거나 다시 말해 주세요.';
        finishListening();
      };
      listening = rec;
      mic.textContent = '음성 입력 마치기';
      mic.setAttribute('aria-pressed', 'true');
      status.textContent = '듣고 있습니다…';
      rec.start();
    } catch {
      finishListening();
      status.textContent = '음성 입력을 시작할 수 없습니다. 글로 입력해 주세요.';
    }
  }

  if (mic) {
    if (Recognition && window.isSecureContext) {
      mic.hidden = false;
      note.hidden = false;
      note.textContent = '음성 입력 시 브라우저의 음성 인식 서비스가 소리를 처리할 수 있습니다.';
      mic.addEventListener('click', startListening);
    } else if (navigator.maxTouchPoints) {
      note.hidden = false;
      note.textContent = '음성 입력은 휴대폰 키보드의 마이크를 이용해 주세요.';
    }
  }

  function readButton(answer) {
    if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '답변 듣기';
    button.setAttribute('aria-pressed', 'false');
    button.onclick = () => {
      const wasPlaying = playback?.button === button;
      stopReading();
      if (wasPlaying) return;
      cancelListening();
      const clean = answer.replace(/\[\s*근거\s*[:：][^\]\n]*\]/gu, '')
        .replace(/^\s*(?:#{1,6}\s+|[-*]\s+)/gm, '').replace(/\*\*/g, '');
      const chunks = clean.match(/[^\n.!?。！？]{1,150}(?:[.!?。！？]+|$)?/gu) || [];
      const parts = chunks.map(text => text.trim()).filter(Boolean);
      if (!parts.length) return;
      const session = { button, utterance: null };
      playback = session;
      button.textContent = '읽기 중지';
      button.setAttribute('aria-pressed', 'true');
      let index = 0;
      const next = () => {
        if (playback !== session) return;
        if (index === parts.length) { stopReading(); return; }
        const speech = new SpeechSynthesisUtterance(parts[index++]);
        session.utterance = speech;
        speech.lang = 'ko-KR';
        const voice = window.speechSynthesis.getVoices().find(v => /^ko(?:-|$)/i.test(v.lang));
        if (voice) speech.voice = voice;
        speech.onend = next;
        speech.onerror = () => {
          if (playback !== session) return;
          stopReading();
          if (status) status.textContent = '이 기기에서 답변을 읽을 수 없습니다. 한국어 음성 설정을 확인해 주세요.';
        };
        window.speechSynthesis.speak(speech);
      };
      next();
    };
    return button;
  }

  function stop() { cancelListening(); stopReading(); }
  window.addEventListener('pagehide', stop);
  window.addEventListener('hashchange', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  function finishDictation() {
    if (!listening) return false;
    listening.stop();
    return true;
  }
  return { readButton, stop, finishDictation };
})();
