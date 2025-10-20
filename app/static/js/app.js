import { dom, state, initialData } from './state.js';
import { setupPlayerLog } from './logger.js';
import { applyTheme } from './theme.js';
import { populateGenres, populateScenes, renderSceneButtons, updateSceneButtonsHighlight } from './scenes.js';
import { ensureInitialDataLoaded, initialiseHysteresis, runRecommend, runSearch } from './search.js';
import { bindPlayerControls } from './player.js';
import { initSpeechControls } from './speech.js';
import { initWhisperToggle } from './whisper.js';

function initialise() {
  setupPlayerLog();

  if (!ensureInitialDataLoaded()) {
    return;
  }

  populateGenres(dom.genreSelect);
  populateGenres(dom.recommendGenre);

  if (!state.genre) {
    state.genre = initialData.genres[0];
  }
  if (dom.genreSelect) {
    dom.genreSelect.value = state.genre;
  }
  if (dom.recommendGenre) {
    dom.recommendGenre.value = state.genre;
  }

  applyTheme(state.genre);
  populateScenes(state.genre);
  renderSceneButtons(state.genre, (sceneId) => runSearch(sceneId));
  initialiseHysteresis();

  if (dom.searchStatus) {
    dom.searchStatus.textContent = 'Выберите сцену и запустите поиск.';
  }

  dom.genreSelect?.addEventListener('change', () => {
    state.genre = dom.genreSelect.value;
    if (dom.recommendGenre) {
      dom.recommendGenre.value = state.genre;
    }
    applyTheme(state.genre);
    state.scene = null;
    populateScenes(state.genre);
    renderSceneButtons(state.genre, (sceneId) => runSearch(sceneId));
    if (dom.searchStatus) {
      dom.searchStatus.textContent = 'Выберите сцену и запустите поиск.';
    }
  });

  dom.sceneSelect?.addEventListener('change', () => {
    state.scene = dom.sceneSelect.value;
    updateSceneButtonsHighlight();
  });

  dom.searchButton?.addEventListener('click', () => runSearch());
  dom.recommendButton?.addEventListener('click', runRecommend);

  bindPlayerControls();
  initSpeechControls();
  initWhisperToggle();
}

initialise();
