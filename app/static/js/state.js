const initialDataElement = document.getElementById('initial-data');
if (!initialDataElement) {
  throw new Error('initial-data element not found. Unable to bootstrap UI.');
}

export const initialData = JSON.parse(initialDataElement.textContent || '{}');

export const state = {
  genre: initialData.genres?.[0] ?? null,
  scene: null,
};

export const dom = {
  genreSelect: document.getElementById('genre-select'),
  sceneSelect: document.getElementById('scene-select'),
  sceneButtonsWrap: document.getElementById('scene-buttons'),
  searchButton: document.getElementById('search-button'),
  searchStatus: document.getElementById('search-status'),
  playerStatus: document.getElementById('player-status'),
  playerLog: document.getElementById('player-log'),
  playerLogClearBtn: document.getElementById('player-log-clear'),
  resultStatus: document.getElementById('result-status'),
  resultContainer: document.getElementById('result-container'),
  resultTitle: document.getElementById('result-title'),
  resultGenre: document.getElementById('result-genre'),
  resultScene: document.getElementById('result-scene'),
  resultConfidence: document.getElementById('result-confidence'),
  resultQuery: document.getElementById('result-query'),
  playlistList: document.getElementById('playlist-list'),
  sceneConfigList: document.getElementById('scene-config'),
  hysteresisList: document.getElementById('hysteresis-list'),
  recommendGenre: document.getElementById('recommend-genre'),
  recommendTags: document.getElementById('recommend-tags'),
  recommendButton: document.getElementById('recommend-button'),
  recommendStatus: document.getElementById('recommend-status'),
  micToggle: document.getElementById('mic-toggle'),
  micStatus: document.getElementById('mic-status'),
  tagsRow: document.getElementById('result-tags'),
  reasonRow: document.getElementById('result-reason'),
  playerPlayBtn: document.getElementById('player-play'),
  playerPauseBtn: document.getElementById('player-pause'),
  playerVolumeInput: document.getElementById('player-volume'),
  providerSelect: document.getElementById('provider-select'),
  providerOpenBtn: document.getElementById('provider-open'),
  whisperToggle: document.getElementById('whisper-toggle'),
  whisperStatus: document.getElementById('whisper-status'),
};

export function formatLabel(value) {
  return String(value || '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
