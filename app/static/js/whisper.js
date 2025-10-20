import { dom } from './state.js';

export function initWhisperToggle() {
  const { whisperToggle, whisperStatus } = dom;
  if (!whisperToggle || !whisperStatus) {
    return;
  }

  whisperToggle.addEventListener('click', async () => {
    if (window.__whisperLoading || window.__whisperReady) {
      window.__whisperEnabled = !window.__whisperEnabled;
      whisperStatus.textContent = window.__whisperEnabled
        ? 'Whisper включен (эксперимент)'
        : 'Whisper выключен.';
      return;
    }

    try {
      window.__whisperLoading = true;
      whisperStatus.textContent = 'Загружаем Whisper-модель…';
      const script = document.createElement('script');
      script.type = 'module';
      script.textContent = `
        import 'https://cdn.jsdelivr.net/npm/@xenova/transformers/dist/transformers.min.js';
        window.__whisperReady = true;
      `;
      document.head.appendChild(script);
      const waitReady = () => {
        if (window.__whisperReady) {
          window.__whisperEnabled = true;
          whisperStatus.textContent =
            'Whisper включен (эксперимент). Для реального распознавания пока используется Web Speech API.';
        } else {
          setTimeout(waitReady, 200);
        }
      };
      waitReady();
    } catch (error) {
      console.error(error);
      whisperStatus.textContent = 'Не удалось загрузить Whisper. Продолжаем через Web Speech API.';
    } finally {
      window.__whisperLoading = false;
    }
  });
}
