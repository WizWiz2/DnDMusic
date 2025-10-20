import { dom } from './state.js';
import { appendPlayerLog } from './logger.js';

let ytPlayer = null;
let ytPlayerReady = false;
let lastSetVolume = 70;
let isUserGestureUnlocked = false;
let isFading = false;
let consecutivePlaybackErrors = 0;
let lastQuery = null;
let lastMeta = null;
let lastVideoIds = [];
let lastPlaylistRequest = null;
let shouldLoadWhenReady = false;
let youtubeApiRequested = false;
let youtubeApiReady = false;
const youtubeApiQueue = [];
let youtubeApiPollerActive = false;

function setPlayerStatus(message, level = 'info') {
  appendPlayerLog(message, level);
  if (dom.playerStatus) {
    dom.playerStatus.textContent = message;
  }
}

function scheduleYouTubeApiCheck(callback) {
  const raf = window.requestAnimationFrame;
  if (typeof raf === 'function') {
    raf(callback);
  } else {
    setTimeout(callback, 80);
  }
}

function flushYouTubeQueue() {
  if (!youtubeApiReady || !window.YT || !window.YT.Player) {
    return;
  }
  while (youtubeApiQueue.length) {
    const callback = youtubeApiQueue.shift();
    try {
      callback();
    } catch (error) {
      console.error('Ошибка инициализации YouTube API', error);
    }
  }
}

function startYouTubeApiPolling() {
  if (youtubeApiPollerActive) {
    return;
  }
  youtubeApiPollerActive = true;

  const poll = () => {
    if (window.YT && typeof window.YT.Player === 'function') {
      youtubeApiReady = true;
      youtubeApiPollerActive = false;
      flushYouTubeQueue();
      return;
    }
    scheduleYouTubeApiCheck(poll);
  };

  poll();
}

function ensureYouTubeApiLoaded(callback) {
  if (window.YT && typeof window.YT.Player === 'function') {
    youtubeApiReady = true;
    callback();
    return;
  }

  youtubeApiQueue.push(callback);
  startYouTubeApiPolling();

  if (youtubeApiRequested) {
    return;
  }

  youtubeApiRequested = true;
  const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
  if (!existing) {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }

  const previousReady = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    youtubeApiReady = true;
    try {
      if (typeof previousReady === 'function') {
        previousReady();
      }
    } catch (error) {
      console.error('Ошибка обработчика onYouTubeIframeAPIReady', error);
    }
    flushYouTubeQueue();
  };
}

function createOrGetPlayer() {
  if (ytPlayer) {
    return ytPlayer;
  }
  ytPlayerReady = false;
  const playerVars = {
    autoplay: 0,
    playsinline: 1,
    rel: 0,
    enablejsapi: 1,
  };

  try {
    const { protocol, origin } = window.location || {};
    if (protocol === 'https:' && typeof origin === 'string') {
      playerVars.origin = origin;
    } else {
      console.warn('[YouTubePlayer] Skipping origin hint for insecure context', {
        protocol,
        origin,
      });
    }
  } catch (error) {
    console.warn('[YouTubePlayer] Unable to determine window origin', error);
  }

  ytPlayer = new YT.Player('player', {
    height: '390',
    width: '640',
    playerVars,
    events: {
      onReady: () => {
        try {
          ytPlayer.setVolume(lastSetVolume);
        } catch (error) {
          console.warn('[YouTubePlayer] Unable to preset volume', error);
        }
        ytPlayerReady = true;
        consecutivePlaybackErrors = 0;
        appendPlayerLog('YouTube IFrame API: плеер готов к работе.', 'success');
        setPlayerStatus('Плеер готов. Выберите сцену и нажмите Play, чтобы начать воспроизведение.', 'success');
        if (shouldLoadWhenReady && lastPlaylistRequest) {
          try {
            performPlaylistLoad(ytPlayer, lastPlaylistRequest);
          } finally {
            shouldLoadWhenReady = false;
          }
        }
      },
      onStateChange: (event) => {
        const YTState = window.YT?.PlayerState;
        if (!YTState) {
          return;
        }
        const stateNames = {
          [YTState.UNSTARTED]: 'UNSTARTED',
          [YTState.ENDED]: 'ENDED',
          [YTState.PLAYING]: 'PLAYING',
          [YTState.PAUSED]: 'PAUSED',
          [YTState.BUFFERING]: 'BUFFERING',
          [YTState.CUED]: 'CUED',
        };
        console.log('[YouTubePlayer] onStateChange', {
          rawState: event.data,
          stateName: stateNames[event.data] ?? 'UNKNOWN',
          timestamp: Date.now(),
        });
        appendPlayerLog(
          `Состояние плеера: ${stateNames[event.data] ?? 'UNKNOWN'} (${event.data})`,
          event.data === YTState.ENDED
            ? 'info'
            : event.data === YTState.PAUSED
            ? 'info'
            : event.data === YTState.BUFFERING
            ? 'debug'
            : event.data === YTState.PLAYING
            ? 'success'
            : 'debug',
        );
        switch (event.data) {
          case YTState.PLAYING:
            consecutivePlaybackErrors = 0;
            setPlayerStatus('Воспроизведение запущено.', 'success');
            break;
          case YTState.BUFFERING:
            setPlayerStatus('Буферизация…', 'debug');
            break;
          case YTState.PAUSED:
            setPlayerStatus('Воспроизведение на паузе.', 'info');
            break;
          case YTState.ENDED:
            setPlayerStatus('Трек завершился, выбираем следующий…', 'info');
            break;
          case YTState.CUED:
            try {
              if (isUserGestureUnlocked) {
                ytPlayer.playVideo();
              }
            } catch (error) {
              console.warn('[YouTubePlayer] Unable to resume from CUED state', error);
            }
            break;
          default:
            break;
        }
      },
      onError: (event) => {
        consecutivePlaybackErrors += 1;
        const errorCode = event?.data;
        const playlistIndex = ytPlayer?.getPlaylistIndex?.();
        const playlist = ytPlayer?.getPlaylist?.();
        const videoData = ytPlayer?.getVideoData?.();
        const logLabel = 'YouTube playback error';
        const errorContext = {
          errorCode,
          lastQuery,
          lastMeta,
          consecutivePlaybackErrors,
          playlistIndex,
          playlist,
          videoData,
        };
        if (typeof console.groupCollapsed === 'function') {
          console.groupCollapsed(logLabel, errorContext);
          if (typeof console.groupEnd === 'function') {
            console.groupEnd();
          }
        } else {
          console.error(logLabel, errorContext);
        }
        const videoTitle = videoData?.title ? ` — ${videoData.title}` : '';
        const playlistItems = Array.isArray(playlist) ? playlist.length : 0;
        const hasValidIndex = typeof playlistIndex === 'number' && playlistIndex >= 0;
        const shouldRetrySearch =
          !hasValidIndex && playlistItems === 0 && lastPlaylistRequest && consecutivePlaybackErrors <= 4;

        if (shouldRetrySearch) {
          setPlayerStatus(`Видео недоступно (ошибка ${errorCode}${videoTitle}), повторяю поиск…`, 'warn');
          setTimeout(() => {
            try {
              appendPlayerLog('Повторная загрузка плейлиста после ошибки YouTube', 'debug');
              performPlaylistLoad(ytPlayer, lastPlaylistRequest);
            } catch (error) {
              console.error('Не удалось повторить поиск после ошибки YouTube', error);
            }
          }, 420);
          return;
        }

        if (consecutivePlaybackErrors <= 5) {
          setPlayerStatus(`Видео недоступно (ошибка ${errorCode}${videoTitle}), переключаюсь на следующий трек…`, 'warn');
          setTimeout(() => {
            try {
              if (typeof ytPlayer.nextVideo === 'function') {
                ytPlayer.nextVideo();
              }
              if (isUserGestureUnlocked && typeof ytPlayer.playVideo === 'function') {
                ytPlayer.playVideo();
              }
            } catch (error) {
              console.error('Не удалось переключить видео после ошибки', error);
            }
          }, 350);
        } else {
          setPlayerStatus(`Не удаётся воспроизвести видео (ошибка ${errorCode}${videoTitle}). Попробуйте другой запрос.`, 'error');
          console.error('Достигнут лимит ошибок воспроизведения, плейлист может быть заблокирован', errorContext);
        }
      },
    },
  });
  return ytPlayer;
}

function setVolumeSmooth(target, durationMs = 600) {
  try {
    const start = lastSetVolume;
    const delta = target - start;
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / durationMs);
      const v = Math.round(start + delta * t);
      ytPlayer.setVolume(v);
      lastSetVolume = v;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        console.log('[setVolumeSmooth] Completed volume ramp', { target, durationMs });
      }
    };
    requestAnimationFrame(step);
    console.log('[setVolumeSmooth] Scheduled volume ramp', { target, durationMs, start });
  } catch (error) {
    console.error('[setVolumeSmooth] Failed to schedule volume ramp', error);
  }
}

function performPlaylistLoad(player, request) {
  if (!player || !request) {
    return;
  }
  const {
    query,
    videoIds = [],
    desiredVol,
    crossfadeSec,
  } = request;

  const playlistIds = Array.isArray(videoIds) ? videoIds.filter((id) => typeof id === 'string' && id.trim().length > 0) : [];
  const hasVideoIds = playlistIds.length > 0;

  if (!hasVideoIds && !query) {
    setPlayerStatus('Нет данных для загрузки плейлиста.', 'warn');
    return;
  }

  consecutivePlaybackErrors = 0;
  if (hasVideoIds) {
    setPlayerStatus('Загружаем готовую подборку треков…', 'info');
  } else if (query) {
    setPlayerStatus(`Загружаем музыку по запросу: ${query}`, 'info');
  }

  const doPlay = () => {
    try {
      const logTarget = hasVideoIds ? `ids:${playlistIds.join(',')}` : query;
      appendPlayerLog(`Запрос к YouTube: loadPlaylist → ${logTarget}`, 'debug');
      if (hasVideoIds) {
        player.loadPlaylist(playlistIds, 0, 0);
        console.log('[performPlaylistLoad] loadPlaylist invoked with IDs', { playlistIds });
      } else {
        player.loadPlaylist({ listType: 'search', list: query, index: 0 });
        console.log('[performPlaylistLoad] loadPlaylist invoked with search', { query });
      }
      setTimeout(() => {
        try {
          console.log('[performPlaylistLoad] setTimeout fired after loadPlaylist', { isUserGestureUnlocked });
          if (isUserGestureUnlocked && typeof player.playVideo === 'function') {
            player.playVideo();
            console.log('[performPlaylistLoad] playVideo invoked from timeout');
          } else {
            console.log('[performPlaylistLoad] playVideo skipped: user gesture not unlocked');
          }
        } catch (error) {
          console.error('[performPlaylistLoad] Error during delayed playVideo', error);
        }
      }, 200);
      setVolumeSmooth(desiredVol, Math.max(200, crossfadeSec * 1000));
      console.log('[performPlaylistLoad] Volume ramp requested', { desiredVol, crossfadeSec });
    } catch (error) {
      console.error('performPlaylistLoad#doPlay', error);
    }
  };

  const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : null;
  const YTState = window.YT?.PlayerState;
  const isActive = YTState && (state === YTState.PLAYING || state === YTState.BUFFERING);

  console.log('[performPlaylistLoad] Entry', {
    request: { query, videoIds: playlistIds, desiredVol, crossfadeSec },
    state,
    isUserGestureUnlocked,
    isActive,
  });

  if (!isUserGestureUnlocked) {
    console.log('[performPlaylistLoad] Branch: awaiting user gesture unlock');
    try {
      player.mute();
    } catch (error) {
      console.warn('[performPlaylistLoad] Unable to mute during gesture unlock', error);
    }
    doPlay();
  } else if (!isActive) {
    console.log('[performPlaylistLoad] Branch: player inactive, starting playback');
    doPlay();
  } else if (!isFading) {
    console.log('[performPlaylistLoad] Branch: initiating crossfade', { crossfadeSec });
    isFading = true;
    setVolumeSmooth(0, Math.max(150, crossfadeSec * 500));
    setTimeout(() => {
      console.log('[performPlaylistLoad] Crossfade timeout reached, loading new playlist');
      doPlay();
      isFading = false;
      console.log('[performPlaylistLoad] Crossfade completed');
    }, Math.max(160, crossfadeSec * 520));
  } else {
    console.log('[performPlaylistLoad] Branch: crossfade already in progress, immediate play');
    doPlay();
  }

  lastPlaylistRequest = {
    query,
    videoIds: playlistIds,
    desiredVol,
    crossfadeSec,
  };
}

export function playSearchOnYouTube(query, videoIds, meta) {
  ensureYouTubeApiLoaded(() => {
    const player = createOrGetPlayer();
    const desiredVol = Number(meta?.volume ?? dom.playerVolumeInput?.value ?? 70);
    const crossfadeSec = Number(meta?.crossfade ?? 3);
    const normalizedQuery = typeof query === 'string' ? query : String(query || '');
    const normalizedIds = Array.isArray(videoIds)
      ? videoIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];
    lastQuery = normalizedQuery;
    lastVideoIds = normalizedIds;
    lastMeta = meta || null;

    const request = {
      query: normalizedQuery,
      videoIds: normalizedIds,
      desiredVol,
      crossfadeSec,
    };
    lastPlaylistRequest = request;

    if (!ytPlayerReady) {
      shouldLoadWhenReady = true;
      return;
    }

    shouldLoadWhenReady = false;
    performPlaylistLoad(player, request);
  });
}

export function applyMetaVolume(metaVolume) {
  const value = Number(metaVolume);
  if (Number.isNaN(value)) {
    return;
  }
  lastSetVolume = value;
  if (dom.playerVolumeInput) {
    dom.playerVolumeInput.value = String(value);
  }
  if (ytPlayer) {
    try {
      ytPlayer.setVolume(value);
    } catch (error) {
      console.error('[applyMetaVolume] Unable to set player volume', error);
    }
  }
}

export function bindPlayerControls() {
  const { playerPlayBtn, playerPauseBtn, playerVolumeInput, providerSelect, providerOpenBtn } = dom;

  if (playerPlayBtn) {
    playerPlayBtn.addEventListener('click', () => {
      ensureYouTubeApiLoaded(() => {
        const player = createOrGetPlayer();
        try {
          player.playVideo();
        } catch (error) {
          console.warn('[PlayerControls] Unable to start playback via playVideo', error);
        }
        try {
          player.unMute();
        } catch (error) {
          console.warn('[PlayerControls] Unable to unmute player', error);
        }
        isUserGestureUnlocked = true;
        if (lastQuery) {
          try {
            playSearchOnYouTube(lastQuery, lastVideoIds, lastMeta);
          } catch (error) {
            console.error('[PlayerControls] Unable to resume last query', error);
          }
        }
      });
    });
  }

  if (playerPauseBtn) {
    playerPauseBtn.addEventListener('click', () => {
      if (!ytPlayer) {
        return;
      }
      try {
        ytPlayer.pauseVideo();
      } catch (error) {
        console.warn('[PlayerControls] Unable to pause video', error);
      }
    });
  }

  if (playerVolumeInput) {
    playerVolumeInput.addEventListener('input', (event) => {
      const value = Number(event.target.value || 0);
      lastSetVolume = value;
      if (!ytPlayer) {
        return;
      }
      try {
        ytPlayer.setVolume(value);
      } catch (error) {
        console.error('[PlayerControls] Unable to set volume from slider', error);
      }
    });
  }

  if (providerOpenBtn) {
    providerOpenBtn.addEventListener('click', () => {
      const url = providerSelect?.value;
      if (url) {
        window.open(url, '_blank', 'noopener');
      }
    });
  }
}
