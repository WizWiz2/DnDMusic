import { dom, state, initialData } from './state.js';
import { applyTheme } from './theme.js';
import { populateScenes, renderSceneButtons, updateSceneButtonsHighlight, getSceneMeta } from './scenes.js';
import { unlockAutoplay } from './player.js';
import { showResult, renderHysteresis } from './results.js';

async function extractErrorMessage(response, fallbackMessage, context) {
  if (!response) {
    return fallbackMessage;
  }

  try {
    const payload = await response.clone().json();
    if (payload && typeof payload === 'object') {
      const detail = payload.detail || payload.message || payload.error;
      if (detail) {
        return String(detail);
      }
    }
  } catch (error) {
    console.debug('Не удалось распарсить JSON ошибки', error);
  }

  if (context === 'recommend' && response.status === 503) {
    return 'Автоподбор сцен временно недоступен. Проверьте настройки сервиса рекомендаций.';
  }

  try {
    const text = await response.text();
    const trimmed = text.trim();
    if (trimmed && !/^</.test(trimmed)) {
      return trimmed.length > 240 ? `${trimmed.slice(0, 237)}…` : trimmed;
    }
  } catch (error) {
    console.debug('Не удалось прочитать текст ошибки', error);
  }

  return fallbackMessage;
}

export async function runSearch(sceneOverride) {
  // Любое нажатие на кнопку — валидный пользовательский жест для разблокировки звука
  unlockAutoplay();
  const { searchStatus, searchButton, sceneSelect } = dom;
  if (!state.genre) {
    if (searchStatus) {
      searchStatus.textContent = 'Сначала выберите жанр.';
    }
    return;
  }

  const scene = sceneOverride || sceneSelect?.value;
  if (!scene) {
    if (searchStatus) {
      searchStatus.textContent = 'Для жанра нет сцен.';
    }
    return;
  }

  if (searchStatus) {
    searchStatus.textContent = 'Загружаем варианты…';
  }
  if (searchButton) {
    searchButton.disabled = true;
  }

  try {
    const params = new URLSearchParams({ genre: state.genre, scene });
    const response = await fetch(`/api/search?${params.toString()}`);
    if (!response.ok) {
      const message = await extractErrorMessage(response, 'Не удалось получить плейлисты', 'search');
      throw new Error(message);
    }
    const result = await response.json();
    state.scene = result.scene;
    updateSceneButtonsHighlight();
    const meta = getSceneMeta(state.genre, result.scene);
    showResult(result, meta, 'search');
    if (searchStatus) {
      searchStatus.textContent = 'Плейлисты обновлены.';
    }
  } catch (error) {
    console.error(error);
    if (searchStatus) {
      searchStatus.textContent = error.message;
    }
  } finally {
    if (searchButton) {
      searchButton.disabled = false;
    }
  }
}

export async function runRecommend() {
  // Нажатие на «Рекомендовать сцену» считается пользовательским жестом — разблокируем звук
  unlockAutoplay();
  const { recommendGenre, recommendTags, recommendStatus, recommendButton, genreSelect, sceneSelect } = dom;
  const genre = recommendGenre?.value;
  const tags = recommendTags?.value
    ?.split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (!genre) {
    if (recommendStatus) {
      recommendStatus.textContent = 'Выберите жанр для рекомендации.';
    }
    return;
  }
  if (!tags || !tags.length) {
    if (recommendStatus) {
      recommendStatus.textContent = 'Добавьте хотя бы один тег.';
    }
    return;
  }

  if (recommendButton) {
    recommendButton.disabled = true;
  }
  if (recommendStatus) {
    recommendStatus.textContent = 'Запрашиваем сцену у нейросети…';
  }

  try {
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genre, tags }),
    });
    if (!response.ok) {
      const message = await extractErrorMessage(response, 'Рекомендация недоступна', 'recommend');
      throw new Error(message);
    }
    const result = await response.json();
    state.genre = result.genre;
    state.scene = result.scene;
    applyTheme(state.genre);
    if (dom.genreSelect) {
      dom.genreSelect.value = state.genre;
    }
    if (recommendGenre) {
      recommendGenre.value = state.genre;
    }
    populateScenes(state.genre);
    if (sceneSelect) {
      sceneSelect.value = result.scene;
    }
    renderSceneButtons(state.genre, (sceneId) => runSearch(sceneId));
    updateSceneButtonsHighlight();
    const meta = getSceneMeta(state.genre, result.scene);
    showResult(result, meta, 'recommend');
    if (recommendStatus) {
      recommendStatus.textContent = 'Готово! Сцена подобрана автоматически.';
    }
  } catch (error) {
    console.error(error);
    if (recommendStatus) {
      recommendStatus.textContent = error.message;
    }
  } finally {
    if (recommendButton) {
      recommendButton.disabled = false;
    }
  }
}

export async function runAutoRecommend(tags) {
  if (!state.genre || !Array.isArray(tags) || !tags.length) {
    return;
  }

  try {
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genre: state.genre, tags }),
    });
    if (!response.ok) {
      const message = await extractErrorMessage(response, 'Рекомендация недоступна', 'recommend');
      throw new Error(message);
    }
    const result = await response.json();
    state.genre = result.genre;
    state.scene = result.scene;
    applyTheme(state.genre);
    if (dom.genreSelect) {
      dom.genreSelect.value = state.genre;
    }
    if (dom.recommendGenre) {
      dom.recommendGenre.value = state.genre;
    }
    populateScenes(state.genre);
    if (dom.sceneSelect) {
      dom.sceneSelect.value = result.scene;
    }
    renderSceneButtons(state.genre, (sceneId) => runSearch(sceneId));
    updateSceneButtonsHighlight();
    const meta = getSceneMeta(state.genre, result.scene);
    showResult(result, meta, 'recommend');
    if (dom.recommendStatus) {
      dom.recommendStatus.textContent = 'Готово! Сцена подобрана автоматически.';
    }
  } catch (error) {
    console.error(error);
    if (dom.recommendStatus) {
      dom.recommendStatus.textContent = error.message;
    }
  }
}

export function ensureInitialDataLoaded() {
  if (!initialData.genres?.length) {
    if (dom.searchStatus) {
      dom.searchStatus.textContent = 'Не удалось загрузить жанры. Проверьте конфигурацию.';
    }
    if (dom.recommendStatus) {
      dom.recommendStatus.textContent = 'Рекомендации недоступны — нет жанров.';
    }
    if (dom.searchButton) {
      dom.searchButton.disabled = true;
    }
    if (dom.recommendButton) {
      dom.recommendButton.disabled = true;
    }
    return false;
  }
  return true;
}

export function initialiseHysteresis() {
  renderHysteresis(initialData.hysteresis || {});
}
