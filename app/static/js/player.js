import { dom } from './state.js';
import { appendPlayerLog } from './logger.js';

let ytPlayer = null;
let ytPlayerReady = false;
let lastSetVolume = 70;
let isUserGestureUnlocked = false;
let isFading = false;
let consecutivePlaybackErrors = 0;
let lastQuery = null;
let lastSearchResult = null;
let lastMeta = null;
let lastPlaylistRequest = null;
let shouldLoadWhenReady = false;
let youtubeApiRequested = false;
let youtubeApiReady = false;
const youtubeApiQueue = [];
let youtubeApiPollerActive = false;
let ytUseNoCookieHost = false;
let ytInitialListParams = null; // optional { listType/list/playlist } to seed player on creation
const PLAYER_ERROR_ENDPOINT = '/api/player-errors';
const ERROR_REPORT_THROTTLE_MS = 8000;
let lastErrorReportSentAt = 0;
let lastErrorReportSignature = null;

function collapseWhitespace(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeYouTubeSearchQuery(value) {
  const collapsed = collapseWhitespace(value);
  if (!collapsed) {
    return '';
  }
  const tokens = collapsed.split(' ');
  const filtered = tokens.filter((token) => {
    if (typeof token !== 'string') {
      return false;
    }
    const trimmed = token.trim();
    if (!trimmed) {
      return false;
    }
    if (trimmed === '-') {
      return false;
    }
    if (trimmed.startsWith('-')) {
      const remainder = trimmed.replace(/^-+/, '');
      if (!remainder.length) {
        return false;
      }
      return false;
    }
    return true;
  });
  if (!filtered.length) {
    return collapsed;
  }
  return filtered.join(' ');
}

function sendPlayerErrorReport(report) {
  const signatureParts = [
    report.errorCode,
    report.videoId || 'none',
    report.request?.searchQuery || report.request?.query || 'no-query',
  ];
  const signature = signatureParts.join('|');
  const now = Date.now();
  if (signature === lastErrorReportSignature && now - lastErrorReportSentAt < ERROR_REPORT_THROTTLE_MS) {
    console.debug('[PlayerErrorReporting] Skip duplicate report', { signature, report });
    return;
  }

  lastErrorReportSignature = signature;
  lastErrorReportSentAt = now;

  const payload = JSON.stringify(report);
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      const accepted = navigator.sendBeacon(PLAYER_ERROR_ENDPOINT, blob);
      if (!accepted) {
        throw new Error('sendBeacon returned false');
      }
      return;
    }
  } catch (error) {
    console.debug('[PlayerErrorReporting] Falling back to fetch', error);
  }

  fetch(PLAYER_ERROR_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch((error) => {
    console.warn('[PlayerErrorReporting] Unable to submit error report', error);
  });
}

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
    // Enable autoplay to allow muted playback without extra clicks
    autoplay: 1,
    playsinline: 1,
    rel: 0,
    enablejsapi: 1,
  };

  // If we have initial list parameters (fallback path), merge them into playerVars
  if (ytInitialListParams && typeof ytInitialListParams === 'object') {
    try {
      Object.assign(playerVars, ytInitialListParams);
    } catch (e) {
      console.warn('[YouTubePlayer] Unable to merge initial list params', e);
    } finally {
      ytInitialListParams = null;
    }
  }

  try {
    const { origin } = window.location || {};
    if (typeof origin === 'string' && origin) {
      // Always pass origin for consistent IFrame API behaviour
      playerVars.origin = origin;
    }
  } catch (error) {
    console.warn('[YouTubePlayer] Unable to determine window origin', error);
  }

  const host = ytUseNoCookieHost
    ? 'https://www.youtube-nocookie.com'
    : 'https://www.youtube.com';

  ytPlayer = new YT.Player('player', {
    height: '390',
    width: '640',
    playerVars,
    host,
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
        const videoId = videoData?.video_id ?? videoData?.videoId ?? null;
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
        const playlistEmpty = playlistItems === 0;
        const playlistTooShort = playlistItems <= 1;
        const playlistAtEnd =
          hasValidIndex && playlistItems > 0 && playlistIndex >= playlistItems - 1;
        const retryReasons = [];
        if (playlistEmpty) {
          retryReasons.push('playlist-empty');
        }
        if (!hasValidIndex) {
          retryReasons.push('invalid-index');
        }
        if (playlistTooShort && !playlistEmpty) {
          retryReasons.push('playlist-too-short');
        }
        if (playlistAtEnd && !playlistEmpty) {
          retryReasons.push('playlist-end');
        }
        // Special-case error 2 (invalid parameter) which sometimes occurs with embedded search
        // on some networks/cookie policies. First try switching to the youtube-nocookie host once.
        if (errorCode === 2 && !ytUseNoCookieHost && lastPlaylistRequest) {
          appendPlayerLog('Ошибка 2 от YouTube. Пробую режим youtube-nocookie…', 'debug');
          try { ytPlayer?.destroy?.(); } catch (e) { /* ignore */ }
          ytPlayer = null;
          ytPlayerReady = false;
          ytUseNoCookieHost = true;
          setTimeout(() => {
            try {
              ensureYouTubeApiLoaded(() => {
                const player = createOrGetPlayer();
                try {
                  performPlaylistLoad(player, lastPlaylistRequest);
                } catch (err) {
                  console.error('Не удалось перезапустить плейлист в режиме nocookie', err);
                }
              });
            } catch (err) {
              console.error('Сбой при переключении на youtube-nocookie', err);
            }
          }, 200);
          return;
        }
        // If we're already on nocookie and still see error 2 — rebuild the player with initial list params.
        if (errorCode === 2 && ytUseNoCookieHost && lastPlaylistRequest) {
          appendPlayerLog('Ошибка 2 сохраняется в режиме nocookie. Пересоздаю плеер с начальным списком…', 'debug');
          recreatePlayerWithInitialListFromRequest(lastPlaylistRequest);
          return;
        }

        const manualList = Array.isArray(lastPlaylistRequest?.manualVideoIds)
          ? lastPlaylistRequest.manualVideoIds
              .map((id) => String(id || '').trim())
              .filter((id) => id.length > 0)
          : [];
        const manualListInitialLength = manualList.length;
        let manualListRemainingLength = manualList.length;
        let manualListWasTrimmed = false;
        let removedManualVideoId = null;
        const manualListActive = manualList.length > 0;

        if (manualListActive) {
          let removalIndex = -1;
          if (typeof videoId === 'string' && videoId.trim().length) {
            removalIndex = manualList.findIndex((id) => id === videoId);
          }
          if (removalIndex < 0 && hasValidIndex && playlistIndex < manualList.length) {
            removalIndex = playlistIndex;
          }

          if (removalIndex < 0 && manualList.length > 0) {
            console.warn('[YouTubePlayer] Unable to match failing manual video, removing the first entry', {
              playlistIndex,
              manualList,
            });
            removalIndex = 0;
          }

          if (removalIndex >= 0 && removalIndex < manualList.length) {
            const failedVideoId = manualList.splice(removalIndex, 1)[0];
            console.warn('[YouTubePlayer] Removing failed manual video from playlist', {
              failedVideoId,
              removalIndex,
              remaining: manualList,
            });

            manualListWasTrimmed = true;
            removedManualVideoId = failedVideoId;
            manualListRemainingLength = manualList.length;

            if (lastPlaylistRequest) {
              lastPlaylistRequest = {
                ...lastPlaylistRequest,
                manualVideoIds: manualList.slice(),
              };
            }
            if (lastSearchResult && Array.isArray(lastSearchResult.youtube_video_ids)) {
              lastSearchResult = {
                ...lastSearchResult,
                youtube_video_ids: manualList.slice(),
              };
            }

            if (manualList.length > 0) {
              setPlayerStatus(
                `Видео недоступно (ошибка ${errorCode}${videoTitle}). Пропускаю ${failedVideoId} и пробую следующий ролик…`,
                'warn',
              );
              setTimeout(() => {
                try {
                  performPlaylistLoad(ytPlayer, lastPlaylistRequest);
                } catch (error) {
                  console.error('Не удалось перезапустить ручной плейлист', error);
                }
              }, 360);
              return;
            }

            setPlayerStatus(
              `Видео недоступно (ошибка ${errorCode}${videoTitle}). Ручной список закончился, пробую резервный источник…`,
              'warn',
            );
            setTimeout(() => {
              try {
                performPlaylistLoad(ytPlayer, lastPlaylistRequest);
              } catch (error) {
                console.error('Не удалось перейти к резервному источнику после исчерпания ручного списка', error);
              }
            }, 360);
            return;
          }
        }

        manualListRemainingLength = manualList.length;

        const shouldRetrySearch =
          lastPlaylistRequest && consecutivePlaybackErrors <= 4 && retryReasons.length > 0;

        const sanitizedRequest = lastPlaylistRequest
          ? (() => {
              const desiredVolNumber = Number(lastPlaylistRequest.desiredVol);
              const crossfadeNumber = Number(lastPlaylistRequest.crossfadeSec);
              const searchQueryValue =
                typeof lastPlaylistRequest.searchQuery === 'string'
                  ? collapseWhitespace(lastPlaylistRequest.searchQuery)
                  : '';
              const payload = {
                query: String(lastPlaylistRequest.query ?? ''),
                desiredVol: Number.isFinite(desiredVolNumber) ? desiredVolNumber : null,
                crossfadeSec: Number.isFinite(crossfadeNumber) ? crossfadeNumber : null,
              };
              if (searchQueryValue) {
                payload.searchQuery = searchQueryValue;
              }
              return payload;
            })()
          : null;
        const report = {
          errorCode,
          videoId,
          request: sanitizedRequest,
          lastQuery,
          playlistIndex:
            typeof playlistIndex === 'number' && Number.isFinite(playlistIndex)
              ? Math.trunc(playlistIndex)
              : null,
          playlistLength: playlistItems,
          consecutivePlaybackErrors,
          reportedAt: new Date().toISOString(),
          manualListActive,
          manualListInitialLength: manualListActive ? manualListInitialLength : null,
          manualListRemainingLength: manualListActive ? manualListRemainingLength : null,
          manualListWasTrimmed: manualListActive ? manualListWasTrimmed : null,
          removedManualVideoId,
        };
        sendPlayerErrorReport(report);

        if (shouldRetrySearch) {
          const reasonLabel = retryReasons.join(', ') || 'unknown-reason';
          setPlayerStatus(`Видео недоступно (ошибка ${errorCode}${videoTitle}), повторяю поиск…`, 'warn');
          setTimeout(() => {
            try {
              appendPlayerLog(
                `Повторная загрузка плейлиста после ошибки YouTube (причина: ${reasonLabel})`,
                'debug',
              );
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

function recreatePlayerWithInitialListFromRequest(request) {
  try {
    const manual = Array.isArray(request?.manualVideoIds)
      ? request.manualVideoIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const playlistId = typeof request?.playlistId === 'string' ? request.playlistId.trim() : '';
    const query = typeof request?.searchQuery === 'string' && request.searchQuery.trim()
      ? request.searchQuery.trim()
      : typeof request?.query === 'string' ? request.query.trim() : '';

    ytInitialListParams = {};
    if (manual.length) {
      ytInitialListParams.playlist = manual.join(',');
    } else if (playlistId) {
      ytInitialListParams.listType = 'playlist';
      ytInitialListParams.list = playlistId;
    } else if (query) {
      ytInitialListParams.listType = 'search';
      ytInitialListParams.list = query;
    }

    try { ytPlayer?.destroy?.(); } catch (e) { /* ignore */ }
    ytPlayer = null;
    ytPlayerReady = false;
    createOrGetPlayer();
    appendPlayerLog('Пересоздан плеер с начальным списком (fallback).', 'debug');
  } catch (error) {
    console.error('[recreatePlayerWithInitialListFromRequest] Failed', error);
  }
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
  const rawQuery = typeof request.query === 'string' ? request.query : '';
  const normalizedQuery = collapseWhitespace(rawQuery);
  const providedSearchQuery =
    typeof request.searchQuery === 'string' ? collapseWhitespace(request.searchQuery) : '';
  const sanitizedQuery = sanitizeYouTubeSearchQuery(normalizedQuery);
  const searchQuery = providedSearchQuery
    ? providedSearchQuery
    : sanitizedQuery
    ? sanitizedQuery
    : normalizedQuery;

  const normalizedRequest = {
    query: normalizedQuery,
    searchQuery,
    desiredVol: Number(request.desiredVol ?? lastSetVolume),
    crossfadeSec: Number(request.crossfadeSec ?? 3),
    playlistId:
      typeof request.playlistId === 'string' && request.playlistId.trim().length
        ? request.playlistId.trim()
        : '',
    manualVideoIds: Array.isArray(request.manualVideoIds)
      ? request.manualVideoIds
          .map((id) => String(id || '').trim())
          .filter((id) => id.length > 0)
      : [],
  };

  const { query, searchQuery: youtubeSearchQuery, desiredVol, crossfadeSec, playlistId, manualVideoIds } =
    normalizedRequest;
  const effectiveSearchQuery = youtubeSearchQuery || query;
  const hasManualList = manualVideoIds.length > 0;
  const hasPlaylistId = playlistId.length > 0;

  consecutivePlaybackErrors = 0;
  if (hasManualList) {
    setPlayerStatus(`Запускаем вручную подобранный плейлист (${manualVideoIds.length} видео).`, 'info');
  } else if (hasPlaylistId) {
    setPlayerStatus(`Загружаем указанный плейлист: ${playlistId}`, 'info');
  } else if (query) {
    setPlayerStatus(`Загружаем музыку по запросу: ${query}`, 'info');
    if (effectiveSearchQuery !== query) {
      appendPlayerLog(
        `YouTube не принимает операторы исключения, используем упрощённый запрос: ${effectiveSearchQuery}`,
        'debug',
      );
    }
  } else {
    setPlayerStatus('Загружаем музыку…', 'info');
  }

  const doPlay = () => {
    try {
      if (hasManualList) {
        appendPlayerLog(
          `Запрос к YouTube: loadPlaylist → ручной список (${manualVideoIds.length} видео)`,
          'debug',
        );
        if (typeof player.loadPlaylist === 'function') {
          player.loadPlaylist(manualVideoIds, 0, 0);
        } else {
          console.warn('[performPlaylistLoad] loadPlaylist is not available on player (manual list) — rebuilding');
          recreatePlayerWithInitialListFromRequest(normalizedRequest);
          return;
        }
        console.log('[performPlaylistLoad] loadPlaylist invoked (manual list)', {
          manualVideoIds,
        });
        lastQuery = 'manual_playlist';
      } else if (hasPlaylistId) {
        appendPlayerLog(
          `Запрос к YouTube: loadPlaylist → playlist ${playlistId}`,
          'debug',
        );
        if (typeof player.loadPlaylist === 'function') {
          player.loadPlaylist({ listType: 'playlist', list: playlistId, index: 0 });
        } else {
          console.warn('[performPlaylistLoad] loadPlaylist is not available on player (playlist) — rebuilding');
          recreatePlayerWithInitialListFromRequest(normalizedRequest);
          return;
        }
        console.log('[performPlaylistLoad] loadPlaylist invoked (playlist)', {
          playlistId,
        });
        lastQuery = `playlist:${playlistId}`;
      } else {
        const youtubeQuery = effectiveSearchQuery;
        appendPlayerLog(
          youtubeQuery !== query
            ? `Запрос к YouTube: loadPlaylist → ${youtubeQuery} (из «${query}» без операторов)`
            : `Запрос к YouTube: loadPlaylist → ${youtubeQuery}`,
          'debug',
        );
        if (typeof player.loadPlaylist === 'function') {
          player.loadPlaylist({ listType: 'search', list: youtubeQuery, index: 0 });
        } else {
          console.warn('[performPlaylistLoad] loadPlaylist is not available on player (search) — rebuilding');
          recreatePlayerWithInitialListFromRequest(normalizedRequest);
          return;
        }
        console.log('[performPlaylistLoad] loadPlaylist invoked (search)', {
          query: youtubeQuery,
          originalQuery: query,
        });
        lastQuery = youtubeQuery;
      }
      try {
        player.playVideo();
        console.log('[performPlaylistLoad] playVideo invoked immediately after load');
      } catch (error) {
        const errorName = error?.name || error?.constructor?.name || 'UnknownError';
        const logMethod = errorName === 'NotAllowedError' ? 'debug' : 'warn';
        console[logMethod](
          '[performPlaylistLoad] Unable to start playback immediately',
          { error, errorName },
        );
      }
      const expectedPlayer = player;
      setTimeout(() => {
        try {
          if (expectedPlayer !== ytPlayer) {
            console.debug('[performPlaylistLoad] Skipping delayed playVideo: player instance changed');
            return;
          }
          const muted = typeof player.isMuted === 'function' ? !!player.isMuted() : false;
          console.log('[performPlaylistLoad] setTimeout fired after loadPlaylist', { isUserGestureUnlocked, muted });
          if (isUserGestureUnlocked || muted) {
            if (typeof player.playVideo === 'function') {
              player.playVideo();
            }
            console.log('[performPlaylistLoad] playVideo invoked from timeout');
          } else {
            console.log('[performPlaylistLoad] playVideo skipped: user gesture not unlocked and not muted');
          }
        } catch (error) {
          console.error('[performPlaylistLoad] Error during delayed playVideo', error);
        }
      }, 200);
      setVolumeSmooth(desiredVol, Math.max(200, crossfadeSec * 1000));
      console.log('[performPlaylistLoad] Volume ramp requested', {
        desiredVol,
        crossfadeSec,
      });
    } catch (error) {
      console.error('performPlaylistLoad#doPlay', error);
    }
  };

  const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : null;
  const YTState = window.YT?.PlayerState;
  const isActive = YTState && (state === YTState.PLAYING || state === YTState.BUFFERING);

  console.log('[performPlaylistLoad] Entry', {
    request: {
      query,
      searchQuery: youtubeSearchQuery,
      desiredVol,
      crossfadeSec,
      playlistId,
      manualVideoIds,
    },
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

  lastPlaylistRequest = normalizedRequest;
}

export function playSearchOnYouTube(result, meta) {
  const normalizeVideoIds = (value) => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((id) => String(id || '').trim())
      .filter((id) => id.length > 0);
  };

  const pickFirstString = (...values) => {
    for (const value of values) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
    return null;
  };

  const payload =
    typeof result === 'string'
      ? { query: result }
      : result && typeof result === 'object'
      ? { ...result }
      : { query: '' };

  const rawQuery = typeof payload.query === 'string' ? payload.query : '';
  const query = collapseWhitespace(rawQuery);
  const searchQueryCandidate = sanitizeYouTubeSearchQuery(query);
  const searchQuery = searchQueryCandidate || query;
  const manualFromResult = normalizeVideoIds(payload.youtube_video_ids);
  const manualFromMeta = normalizeVideoIds(meta?.youtube_video_ids);
  const manualVideoIds = manualFromResult.length ? manualFromResult : manualFromMeta;
  const playlistId = pickFirstString(payload.youtube_playlist_id, meta?.youtube_playlist_id);

  lastSearchResult = {
    query,
    youtube_playlist_id: playlistId,
    youtube_video_ids: manualVideoIds.slice(),
    search_query: searchQuery,
  };
  lastQuery =
    manualVideoIds.length
      ? 'manual_playlist'
      : playlistId
      ? `playlist:${playlistId}`
      : searchQuery;
  lastMeta = meta || null;

  ensureYouTubeApiLoaded(() => {
    const player = createOrGetPlayer();
    const desiredVol = Number(meta?.volume ?? dom.playerVolumeInput?.value ?? 70);
    const crossfadeSec = Number(meta?.crossfade ?? 3);
    const request = {
      query,
      searchQuery,
      desiredVol,
      crossfadeSec,
      playlistId,
      manualVideoIds,
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
      // Unlock autoplay policies as early as possible
      isUserGestureUnlocked = true;

      ensureYouTubeApiLoaded(() => {
        const player = createOrGetPlayer();

        // If the player is not yet fully ready, schedule load on ready and exit
        if (!ytPlayerReady) {
          shouldLoadWhenReady = true;
          return;
        }

        const playlist =
          typeof player.getPlaylist === 'function' ? player.getPlaylist() : null;
        const playlistLength = Array.isArray(playlist) ? playlist.length : 0;
        const hasPendingRequest = Boolean(lastPlaylistRequest);
        const shouldResumePending = playlistLength === 0 && hasPendingRequest;
        const shouldReplayLastSearch =
          playlistLength === 0 && !hasPendingRequest && Boolean(lastSearchResult);

        if (shouldResumePending && lastPlaylistRequest) {
          try {
            performPlaylistLoad(player, lastPlaylistRequest);
          } catch (error) {
            console.error('[PlayerControls] Unable to resume pending playlist', error);
          }
        } else if (shouldReplayLastSearch && lastSearchResult) {
          try {
            playSearchOnYouTube(lastSearchResult, lastMeta);
          } catch (error) {
            console.error('[PlayerControls] Unable to resume last query', error);
          }
        }

        // Guard player API calls behind readiness and feature detection
        try {
          if (typeof player.unMute === 'function') {
            player.unMute();
          }
        } catch (error) {
          console.warn('[PlayerControls] Unable to unmute player', error);
        }
        try {
          if (typeof player.playVideo === 'function') {
            player.playVideo();
          }
        } catch (error) {
          console.warn('[PlayerControls] Unable to start playback via playVideo', error);
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
