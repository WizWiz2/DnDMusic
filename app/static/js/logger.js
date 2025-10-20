import { dom } from './state.js';

const PLAYER_LOG_MAX_ENTRIES = 250;

export function appendPlayerLog(message, level = 'info') {
  const { playerLog } = dom;
  if (!playerLog) {
    return;
  }

  const levelValue = level || 'info';
  const timestamp = new Date();
  const formattedTs = timestamp
    .toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    .trim();

  const entry = document.createElement('div');
  entry.className = 'player-log-entry';
  entry.dataset.level = levelValue;
  entry.textContent = `[${formattedTs}] [${levelValue.toUpperCase()}] ${message}`;
  playerLog.append(entry);
  while (playerLog.children.length > PLAYER_LOG_MAX_ENTRIES) {
    playerLog.removeChild(playerLog.firstChild);
  }
  playerLog.scrollTop = playerLog.scrollHeight;
}

function serializeConsoleArgs(args) {
  return args
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }
      if (value instanceof Error) {
        return value.stack || value.message || String(value);
      }
      try {
        const json = JSON.stringify(value);
        if (typeof json === 'string') {
          return json;
        }
        return String(value);
      } catch (error) {
        return String(value);
      }
    })
    .join(' ');
}

export function setupPlayerLog() {
  const { playerLog, playerLogClearBtn } = dom;

  if (playerLogClearBtn) {
    playerLogClearBtn.addEventListener('click', () => {
      if (playerLog) {
        playerLog.innerHTML = '';
        appendPlayerLog('Журнал очищен.', 'info');
      }
    });
  }

  if (!playerLog) {
    return;
  }

  const originalConsoleError = console.error.bind(console);
  const originalConsoleWarn = console.warn.bind(console);

  console.error = (...args) => {
    try {
      appendPlayerLog(serializeConsoleArgs(args), 'error');
    } catch (error) {
      originalConsoleError('Не удалось записать ошибку в журнал', error);
    }
    originalConsoleError(...args);
  };

  console.warn = (...args) => {
    try {
      appendPlayerLog(serializeConsoleArgs(args), 'warn');
    } catch (error) {
      originalConsoleError('Не удалось записать предупреждение в журнал', error);
    }
    originalConsoleWarn(...args);
  };
}
