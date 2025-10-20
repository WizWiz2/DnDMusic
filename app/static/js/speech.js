import { dom, initialData } from './state.js';
import { runAutoRecommend } from './search.js';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
let lastAutoAt = 0;

function extractTags(text) {
  const t = String(text || '').toLowerCase();
  const tags = new Set();
  if (/(\bбой|\bбитв|\bсхватк|battle|attack|fight)/.test(t)) tags.add('battle');
  if (/(таверн|бар|inn|tavern)/.test(t)) tags.add('tavern');
  if (/(исслед|поиск|путь|дорог|explor|travel|journey|forest|ruins)/.test(t)) tags.add('exploration');
  if (/(напряж|страх|жутк|опасн|trap|tension|suspense)/.test(t)) tags.add('tension');
  if (/(погон|преслед|chase|pursuit)/.test(t)) tags.add('chase');
  if (/(ритуал|обряд|ritual)/.test(t)) tags.add('ritual');
  if (/(отдых|camp|rest)/.test(t)) tags.add('rest');
  if (/(дракон|dragon|драконы)/.test(t)) tags.add('dragons');
  return Array.from(tags);
}

function canFireAuto(nowMs) {
  const windowSec = Number(initialData.hysteresis?.window_sec ?? 30);
  const cooldownSec = Number(initialData.hysteresis?.cooldown_sec ?? 60);
  const minGapMs = (windowSec + cooldownSec) * 1000;
  return nowMs - lastAutoAt >= minGapMs;
}

function startListening() {
  const { micStatus, micToggle } = dom;
  if (!SpeechRecognition) {
    if (micStatus) {
      micStatus.textContent = 'Распознавание недоступно в этом браузере.';
    }
    return;
  }
  if (listening) {
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'ru-RU';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    listening = true;
    if (micToggle) {
      micToggle.textContent = '⏸ Остановить прослушивание';
    }
    if (micStatus) {
      micStatus.textContent = 'Идёт прослушивание… говорите фразы естественно.';
    }
  };

  recognition.onerror = (event) => {
    console.error(event);
    if (micStatus) {
      micStatus.textContent = 'Ошибка распознавания речи.';
    }
  };

  recognition.onend = () => {
    listening = false;
    if (micToggle) {
      micToggle.textContent = '🎙 Включить прослушивание';
    }
    if (micStatus) {
      micStatus.textContent = 'Распознавание речи выключено.';
    }
  };

  recognition.onresult = (event) => {
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) {
        finalText += `${result[0].transcript} `;
      }
    }
    if (finalText.trim()) {
      const now = Date.now();
      const tags = extractTags(finalText);
      if (tags.length) {
        if (micStatus) {
          micStatus.textContent = `Распознано: ${finalText.trim()} → теги: ${tags.join(', ')}`;
        }
        if (canFireAuto(now)) {
          lastAutoAt = now;
          runAutoRecommend(tags);
        }
      } else if (micStatus) {
        micStatus.textContent = `Распознано: ${finalText.trim()}`;
      }
    }
  };

  try {
    recognition.start();
  } catch (error) {
    console.error('Не удалось запустить распознавание речи', error);
  }
}

function stopListening() {
  if (recognition && listening) {
    try {
      recognition.stop();
    } catch (error) {
      console.error('Не удалось остановить распознавание речи', error);
    }
  }
}

export function initSpeechControls() {
  const { micToggle, micStatus } = dom;
  if (!micToggle) {
    return;
  }

  micToggle.addEventListener('click', () => {
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  });

  if (micStatus) {
    micStatus.textContent = 'Распознавание речи выключено.';
  }
}
