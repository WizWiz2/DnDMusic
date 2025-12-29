import { dom, initialData, logRecognition } from './state.js';
import { runAutoRecommend } from './search.js';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
let lastAutoAt = 0;

function extractTags(text) {
  const t = String(text || '').toLowerCase();
  const tags = new Set();
  // Battle/combat (убираем \b для кириллицы - не работает с Unicode)
  if (/(бой|битв|схватк|атак|удар|напад|врыв|сраж|battle|attack|fight|combat)/.test(t)) tags.add('battle');
  // Tavern/inn
  if (/(таверн|бар|трактир|inn|tavern|drink|ale|пиво)/.test(t)) tags.add('tavern');
  // Exploration
  if (/(исслед|поиск|путь|дорог|explor|travel|journey|forest|ruins|пещер|dungeon)/.test(t)) tags.add('exploration');
  // Tension/danger
  if (/(напряж|страх|жутк|опасн|ловушк|trap|tension|suspense|danger|scary)/.test(t)) tags.add('tension');
  // Chase
  if (/(погон|преслед|беж|убега|chase|pursuit|run|escape)/.test(t)) tags.add('chase');
  // Ritual/magic
  if (/(ритуал|обряд|магия|колдов|заклин|ritual|magic|spell|arcane)/.test(t)) tags.add('ritual');
  // Rest/camp
  if (/(отдых|лагер|костер|camp|rest|fire|sleep|сон)/.test(t)) tags.add('rest');
  // Dragons
  if (/(дракон|dragon|драконы)/.test(t)) tags.add('dragons');
  // Market/trade
  if (/(торг|купить|продать|рынок|shop|merchant|gold|монет)/.test(t)) tags.add('market');
  // Mourning/death
  if (/(смерть|умир|мёртв|погиб|скорбь|похорон|могил|funeral|grave|corpse|труп|dead|death)/.test(t)) tags.add('mourning');
  // Celebration/party
  if (/(праздник|веселье|танц|пир|celebration|party|feast|dance)/.test(t)) tags.add('celebration');
  // Storm
  if (/(шторм|буря|гроза|storm|thunder|lightning|дожд)/.test(t)) tags.add('storm');
  // Boss battle
  if (/(босс|финальн|главный враг|boss|final|villain)/.test(t)) tags.add('boss_battle');
  // Stealth
  if (/(скрыт|тихо|стелс|stealth|sneak|hidden)/.test(t)) tags.add('stealth');
  return Array.from(tags);
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractTags };
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
      micToggle.textContent = '⏹ Стоп';
    }
    logRecognition('🎙 Микрофон включён, слушаю...', 'info');
  };

  recognition.onerror = (event) => {
    console.error(event);
    logRecognition(`❌ Ошибка: ${event.error}`, 'error');
  };

  recognition.onend = () => {
    listening = false;
    if (micToggle) {
      micToggle.textContent = '🎙 Микрофон';
    }
    logRecognition('⏹ Микрофон выключен', 'info');
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
      logRecognition(`📝 Вход: "${finalText.trim()}"`, 'input');
      const tags = extractTags(finalText);
      if (tags.length) {
        logRecognition(`🏷 Теги: [${tags.join(', ')}]`, 'output');
        if (canFireAuto(now)) {
          lastAutoAt = now;
          logRecognition(`🚀 Решение: отправляем рекомендацию с тегами [${tags.join(', ')}]`, 'decision');
          runAutoRecommend(tags);
        } else {
          logRecognition('⏳ Пропуск: антидребезг (cooldown)', 'info');
        }
      } else {
        logRecognition('⚠️ Теги не найдены', 'info');
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
