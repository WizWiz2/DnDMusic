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

function makeJsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
    async text() {
      if (typeof payload === 'string') {
        return payload;
      }
      try {
        return JSON.stringify(payload);
      } catch (error) {
        return '';
      }
    },
    clone() {
      return makeJsonResponse(payload, { ok, status });
    },
  };
}

class FakeStyle {
  constructor() {
    this.properties = new Map();
  }

  setProperty(name, value) {
    this.properties.set(name, value);
  }

  getPropertyValue(name) {
    return this.properties.get(name) ?? '';
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.classes = new Set();
  }

  _sync() {
    this.element._className = Array.from(this.classes).join(' ');
  }

  _setFromString(value) {
    this.classes = new Set(String(value || '').split(/\s+/).filter(Boolean));
    this._sync();
  }

  add(...classNames) {
    classNames.flat().forEach((name) => {
      if (typeof name === 'string' && name.trim().length) {
        this.classes.add(name.trim());
      }
    });
    this._sync();
  }

  remove(...classNames) {
    classNames.flat().forEach((name) => {
      if (typeof name === 'string') {
        this.classes.delete(name.trim());
      }
    });
    this._sync();
  }

  toggle(className, force) {
    if (typeof className !== 'string' || !className.trim().length) {
      return this.classes.has(className);
    }
    const normalized = className.trim();
    if (force === true) {
      this.classes.add(normalized);
      this._sync();
      return true;
    }
    if (force === false) {
      this.classes.delete(normalized);
      this._sync();
      return false;
    }
    if (this.classes.has(normalized)) {
      this.classes.delete(normalized);
      this._sync();
      return false;
    }
    this.classes.add(normalized);
    this._sync();
    return true;
  }

  contains(className) {
    if (typeof className !== 'string') {
      return false;
    }
    return this.classes.has(className.trim());
  }

  toString() {
    return Array.from(this.classes).join(' ');
  }

  get length() {
    return this.classes.size;
  }
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
    this._className = '';
    this.classList = new FakeClassList(this);
    this.style = {};
    this.value = '';
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.parentNode = null;
    this.ownerDocument = null;
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
    this.children.forEach((child) => {
      child.parentNode = null;
    });
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set className(value) {
    this.classList._setFromString(value);
  }

  get className() {
    return this._className;
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
    this.head.ownerDocument = this;
    this.documentElement = new FakeElement('html', 'html');
    this.documentElement.ownerDocument = this;
    this.documentElement.style = new FakeStyle();
  }

  registerElement(id, element = new FakeElement(id)) {
    element.id = id;
    element.ownerDocument = this;
    this.elements.set(id, element);
    return element;
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  createElement(tagName) {
    const element = new FakeElement(null, tagName);
    element.ownerDocument = this;
    return element;
  }

  querySelector(selector) {
    const match = selector.match(/^script\[src="(.+)"\]$/);
    if (!match) {
      return null;
    }
    const src = match[1];
    return this.head.children.find((child) => child.src === src) || null;
  }

  querySelectorAll(selector) {
    if (typeof selector !== 'string' || !selector.startsWith('.')) {
      return [];
    }
    const className = selector.slice(1).trim();
    if (!className.length) {
      return [];
    }
    const results = [];
    const visited = new Set();
    const visit = (element) => {
      if (!element || visited.has(element)) {
        return;
      }
      visited.add(element);
      if (element.classList?.contains(className)) {
        results.push(element);
      }
      element.children.forEach((child) => visit(child));
    };
    visit(this.documentElement);
    visit(this.head);
    for (const element of this.elements.values()) {
      visit(element);
    }
    return results;
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
  initialData.textContent = JSON.stringify({
    genres: ['test'],
    scenes: {
      test: [
        { id: 'battle', name: 'Battle' },
        { id: 'camp', name: 'Camp' },
      ],
    },
  });
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
  const fetchResponses = [];

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
    let next = fetchResponses.length ? fetchResponses.shift() : null;
    if (typeof next === 'function') {
      next = next(url, options);
    }
    if (!next) {
      next = makeJsonResponse({});
    }
    return Promise.resolve(next);
  };
  windowObject.queueFetchResponse = (response) => {
    fetchResponses.push(response);
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

  return { document, beaconCalls, fetchCalls, queueFetchResponse: windowObject.queueFetchResponse };
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

const { beaconCalls, fetchCalls, queueFetchResponse } = setupEnvironment();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..');

const stateModuleUrl = pathToFileURL(resolve(repoRoot, 'app/static/js/state.js'));
const playerModuleUrl = pathToFileURL(resolve(repoRoot, 'app/static/js/player.js'));
const searchModuleUrl = pathToFileURL(resolve(repoRoot, 'app/static/js/search.js'));

const stateModule = await import(stateModuleUrl.href);

window.YT = {
  Player: FakeYTPlayer,
  PlayerState: FakeYTPlayer.PlayerState,
};

globalThis.YT = window.YT;

const playerModule = await import(playerModuleUrl.href);
const { playSearchOnYouTube, bindPlayerControls } = playerModule;
const searchModule = await import(searchModuleUrl.href);
const { runRecommend, runAutoRecommend } = searchModule;

bindPlayerControls();

const { dom } = stateModule;

playSearchOnYouTube(
  {
    query: 'manual test query -vocals',
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

dom.recommendGenre.value = 'test';
dom.recommendTags.value = 'epic, battle';

queueFetchResponse(
  makeJsonResponse({
    genre: 'test',
    scene: 'battle',
    playlists: [],
    hysteresis: {},
    tags: ['epic', 'battle'],
  }),
);

await runRecommend();

assert.equal(stateModule.state.scene, 'battle', 'После runRecommend состояние должно обновить сцену');
assert.equal(dom.sceneSelect.value, 'battle', 'Select сцены должен совпадать с рекомендацией');

const chipsAfterRecommend = document.querySelectorAll('.scene-chip');
assert.equal(
  chipsAfterRecommend.length,
  2,
  'После runRecommend должно отображаться по кнопке на каждую сцену жанра',
);
const activeAfterRecommend = chipsAfterRecommend
  .filter((chip) => chip.classList.contains('active'))
  .map((chip) => chip.dataset.scene);
assert.deepEqual(
  activeAfterRecommend,
  ['battle'],
  'После runRecommend активной должна быть рекомендованная сцена',
);

queueFetchResponse(
  makeJsonResponse({
    genre: 'test',
    scene: 'camp',
    playlists: [],
    hysteresis: {},
    tags: ['calm'],
  }),
);

await runAutoRecommend(['calm']);

assert.equal(
  stateModule.state.scene,
  'camp',
  'runAutoRecommend должен обновлять текущую сцену в состоянии',
);
assert.equal(dom.sceneSelect.value, 'camp', 'Select сцены должен обновляться после runAutoRecommend');

const chipsAfterAuto = document.querySelectorAll('.scene-chip');
const activeAfterAuto = chipsAfterAuto
  .filter((chip) => chip.classList.contains('active'))
  .map((chip) => chip.dataset.scene);
assert.deepEqual(
  activeAfterAuto,
  ['camp'],
  'После runAutoRecommend подсветка должна соответствовать новой сцене',
);

console.log('Recommendation scene selection scenario passed');
