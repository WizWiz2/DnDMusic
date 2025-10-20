import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

class FakeElement {
  constructor(id = null, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.eventListeners = new Map();
    this._textContent = '';
    this._innerHTML = '';
    this.className = '';
    this.style = {};
    this.value = '';
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.parentNode = null;
  }

  append(child) {
    this.children.push(child);
    child.parentNode = this;
    this.scrollHeight = this.children.length;
    return child;
  }

  appendChild(child) {
    return this.append(child);
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
    }
    this.scrollHeight = this.children.length;
    return child;
  }

  get firstChild() {
    return this.children.length ? this.children[0] : null;
  }

  set textContent(value) {
    this._textContent = String(value);
    this._innerHTML = this._textContent;
  }

  get textContent() {
    return this._textContent;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this._textContent = this._innerHTML;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  addEventListener(type, handler) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(handler);
  }

  dispatchEvent(event) {
    const listeners = this.eventListeners.get(event.type) || [];
    for (const handler of listeners) {
      handler(event);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.head = new FakeElement('head', 'head');
  }

  registerElement(id, element = new FakeElement(id)) {
    element.id = id;
    this.elements.set(id, element);
    return element;
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  createElement(tagName) {
    return new FakeElement(null, tagName);
  }

  querySelector(selector) {
    const match = selector.match(/^script\[src="(.+)"\]$/);
    if (!match) {
      return null;
    }
    const src = match[1];
    return this.head.children.find((child) => child.src === src) || null;
  }
}

class FakeBlob {
  constructor(parts, options = {}) {
    this.parts = Array.isArray(parts) ? parts : [parts];
    this.type = options.type || '';
  }
}

function setupEnvironment() {
  const document = new FakeDocument();
  const ids = [
    'initial-data',
    'genre-select',
    'scene-select',
    'scene-buttons',
    'search-button',
    'search-status',
    'player-status',
    'player-log',
    'player-log-clear',
    'result-status',
    'result-container',
    'result-title',
    'result-genre',
    'result-scene',
    'result-confidence',
    'result-query',
    'playlist-list',
    'scene-config',
    'hysteresis-list',
    'recommend-genre',
    'recommend-tags',
    'recommend-button',
    'recommend-status',
    'mic-toggle',
    'mic-status',
    'result-tags',
    'result-reason',
    'player-play',
    'player-pause',
    'player-volume',
    'provider-select',
    'provider-open',
    'whisper-toggle',
    'whisper-status',
    'player',
  ];
  for (const id of ids) {
    document.registerElement(id);
  }
  const initialData = document.getElementById('initial-data');
  initialData.textContent = JSON.stringify({ genres: ['test'], scenes: [] });
  const playerVolume = document.getElementById('player-volume');
  playerVolume.value = '70';

  const windowObject = {
    document,
    location: { protocol: 'https:', origin: 'https://example.test' },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (handle) => clearTimeout(handle),
    open: () => {},
    console,
  };

  const beaconCalls = [];
  const fetchCalls = [];

  const navigatorObject = {
    sendBeacon(url, blob) {
      let body = '';
      if (blob instanceof FakeBlob) {
        body = blob.parts.map((part) => (typeof part === 'string' ? part : String(part))).join('');
      } else if (typeof blob === 'string') {
        body = blob;
      } else {
        body = JSON.stringify(blob);
      }
      beaconCalls.push({ url, body });
      return true;
    },
  };

  windowObject.navigator = navigatorObject;
  windowObject.fetch = (url, options = {}) => {
    fetchCalls.push({ url, options });
    return Promise.resolve({ ok: true });
  };
  windowObject.performance = { now: () => Date.now() };
  windowObject.setTimeout = setTimeout;
  windowObject.clearTimeout = clearTimeout;

  globalThis.window = windowObject;
  globalThis.document = document;
  globalThis.navigator = navigatorObject;
  globalThis.Blob = FakeBlob;
  globalThis.performance = windowObject.performance;
  globalThis.requestAnimationFrame = windowObject.requestAnimationFrame;
  globalThis.__beaconCalls = beaconCalls;
  globalThis.fetch = windowObject.fetch;
  document.defaultView = windowObject;

  return { document, beaconCalls, fetchCalls };
}

class FakeYTPlayer {
  constructor(elementId, config) {
    this.elementId = elementId;
    this.config = config || {};
    this.state = FakeYTPlayer.PlayerState.UNSTARTED;
    this.volume = 70;
    this.playlist = [];
    this.playlistIndex = 0;
    this.videoData = null;
    this.muted = false;
    this.loadHistory = [];
    FakeYTPlayer.instances.push(this);
    setTimeout(() => {
      this.config.events?.onReady?.({ target: this });
    }, 0);
  }

  loadPlaylist(arg, index = 0) {
    let entry;
    if (Array.isArray(arg)) {
      this.playlist = arg.slice();
      this.playlistIndex = Math.max(0, Number(index) || 0);
      const currentId = this.playlist[this.playlistIndex] || null;
      this.videoData = currentId
        ? { video_id: currentId, videoId: currentId, title: `Video ${currentId}` }
        : null;
      entry = { type: 'manual', items: this.playlist.slice() };
    } else if (arg && typeof arg === 'object') {
      const listValue = arg.list ?? null;
      this.playlist = typeof listValue === 'string' ? [listValue] : [];
      this.playlistIndex = Number(arg.index ?? 0) || 0;
      const currentId = this.playlist[this.playlistIndex] || null;
      this.videoData = currentId
        ? { video_id: currentId, videoId: currentId, title: `Video ${currentId}` }
        : null;
      entry = { type: arg.listType || 'unknown', request: { ...arg } };
    } else {
      entry = { type: 'unknown', request: arg };
    }
    FakeYTPlayer.loadHistory.push(entry);
    this.loadHistory.push(entry);
  }

  playVideo() {
    this.state = FakeYTPlayer.PlayerState.PLAYING;
    this.config.events?.onStateChange?.({ data: FakeYTPlayer.PlayerState.PLAYING });
  }

  pauseVideo() {
    this.state = FakeYTPlayer.PlayerState.PAUSED;
    this.config.events?.onStateChange?.({ data: FakeYTPlayer.PlayerState.PAUSED });
  }

  nextVideo() {
    if (this.playlistIndex < this.playlist.length - 1) {
      this.playlistIndex += 1;
    }
    const currentId = this.playlist[this.playlistIndex] || null;
    this.videoData = currentId
      ? { video_id: currentId, videoId: currentId, title: `Video ${currentId}` }
      : null;
  }

  mute() {
    this.muted = true;
  }

  unMute() {
    this.muted = false;
  }

  setVolume(value) {
    this.volume = value;
  }

  getPlayerState() {
    return this.state;
  }

  getPlaylist() {
    return this.playlist.slice();
  }

  getPlaylistIndex() {
    return this.playlistIndex;
  }

  getVideoData() {
    return this.videoData;
  }

  triggerError(code) {
    const error = { data: code };
    this.config.events?.onError?.(error);
  }
}

FakeYTPlayer.instances = [];
FakeYTPlayer.loadHistory = [];
FakeYTPlayer.PlayerState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

const { beaconCalls, fetchCalls } = setupEnvironment();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..');

const stateModuleUrl = pathToFileURL(resolve(repoRoot, 'app/static/js/state.js'));
const playerModuleUrl = pathToFileURL(resolve(repoRoot, 'app/static/js/player.js'));

const stateModule = await import(stateModuleUrl.href);

window.YT = {
  Player: FakeYTPlayer,
  PlayerState: FakeYTPlayer.PlayerState,
};

globalThis.YT = window.YT;

const playerModule = await import(playerModuleUrl.href);
const { playSearchOnYouTube, bindPlayerControls } = playerModule;

bindPlayerControls();

const { dom } = stateModule;

playSearchOnYouTube(
  {
    query: 'manual test query',
    youtube_video_ids: ['AAA111', 'BBB222'],
  },
  {
    volume: 55,
    crossfade: 0.4,
  },
);

await sleep(20);

const playerInstance = FakeYTPlayer.instances[0];
assert.ok(playerInstance, 'Должен быть создан экземпляр плеера');

await sleep(50);

const baselineCalls = FakeYTPlayer.loadHistory.length;
assert.ok(
  baselineCalls >= 1,
  `Ожидался хотя бы один вызов loadPlaylist до разблокировки, получено ${baselineCalls}`,
);

dom.playerPlayBtn.click();

await sleep(80);

const unlockedBaseline = FakeYTPlayer.loadHistory.length;
assert.ok(
  unlockedBaseline >= baselineCalls,
  'Количество вызовов loadPlaylist не должно уменьшаться после разблокировки',
);

let historyBaseline = unlockedBaseline;

playerInstance.triggerError(2);

await sleep(800);

const newEntriesAfterFirstError = FakeYTPlayer.loadHistory.slice(historyBaseline);
const manualReload = newEntriesAfterFirstError.find(
  (entry) => entry.type === 'manual' && arraysEqual(entry.items, ['BBB222']),
);
assert.ok(
  manualReload,
  'После первой ошибки должен появиться вызов loadPlaylist с оставшимся роликом',
);

historyBaseline = FakeYTPlayer.loadHistory.length;

playerInstance.triggerError(2);

await sleep(800);

const newEntriesAfterSecondError = FakeYTPlayer.loadHistory.slice(historyBaseline);
const fallbackEntry = newEntriesAfterSecondError.find(
  (entry) => entry.type === 'search' && entry.request?.list === 'manual test query',
);
assert.ok(
  fallbackEntry,
  'После второй ошибки должен запускаться поиск по исходному запросу',
);

const manualListEntriesAfterSecond = newEntriesAfterSecondError.filter((entry) => entry.type === 'manual');
assert.ok(
  manualListEntriesAfterSecond.every((entry) => !arraysEqual(entry.items, [])),
  'После исчерпания ручного списка не должно быть пустых ручных загрузок',
);

console.log('YouTube player functional scenario passed');
