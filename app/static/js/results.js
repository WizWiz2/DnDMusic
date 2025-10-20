import { dom, formatLabel } from './state.js';
import { appendPlayerLog } from './logger.js';
import { playSearchOnYouTube, applyMetaVolume } from './player.js';

export function renderHysteresis(data) {
  const { hysteresisList } = dom;
  if (!hysteresisList) {
    return;
  }

  hysteresisList.innerHTML = '';
  const entries = [
    ['Минимальная уверенность', data?.min_confidence],
    ['Окно (сек)', data?.window_sec],
    ['Кулдаун (сек)', data?.cooldown_sec],
  ];
  entries.forEach(([label, value]) => {
    if (value === null || value === undefined) {
      return;
    }
    const li = document.createElement('li');
    li.textContent = `${label}: ${value}`;
    hysteresisList.append(li);
  });
}

export function renderSceneConfig(meta) {
  const { sceneConfigList } = dom;
  if (!sceneConfigList) {
    return;
  }

  sceneConfigList.innerHTML = '';
  if (!meta) {
    const li = document.createElement('li');
    li.textContent = 'Нет дополнительной информации о сцене';
    sceneConfigList.append(li);
    return;
  }

  const fields = [];
  if (meta.volume !== null && meta.volume !== undefined) {
    fields.push(['Рекомендуемая громкость', `${meta.volume}%`]);
  }
  if (meta.crossfade !== null && meta.crossfade !== undefined) {
    fields.push(['Кроссфейд', `${meta.crossfade} с`]);
  }
  if (meta.cooldown_sec !== null && meta.cooldown_sec !== undefined) {
    fields.push(['Рекомендованный кулдаун', `${meta.cooldown_sec} с`]);
  }
  if (meta.providers && meta.providers.length) {
    fields.push(['Провайдеры', meta.providers.map((p) => p.name).join(', ')]);
  }
  if (typeof meta.youtube_playlist_id === 'string' && meta.youtube_playlist_id.trim().length) {
    fields.push(['YouTube плейлист', meta.youtube_playlist_id.trim()]);
  }
  if (Array.isArray(meta.youtube_video_ids) && meta.youtube_video_ids.length) {
    fields.push(['Ручной список видео', `${meta.youtube_video_ids.length} шт.`]);
  }

  if (!fields.length) {
    const li = document.createElement('li');
    li.textContent = 'Для сцены нет дополнительных параметров';
    sceneConfigList.append(li);
    return;
  }

  fields.forEach(([label, value]) => {
    const li = document.createElement('li');
    li.textContent = `${label}: ${value}`;
    sceneConfigList.append(li);
  });
}

export function renderPlaylists(playlists) {
  const { playlistList, providerSelect } = dom;
  if (!playlistList) {
    return;
  }

  playlistList.innerHTML = '';
  if (!playlists || !playlists.length) {
    const li = document.createElement('li');
    li.textContent = 'Плейлисты не найдены.';
    playlistList.append(li);
  } else {
    playlists.forEach((playlist) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = playlist.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = playlist.provider;
      li.append(link);
      if (playlist.description) {
        const desc = document.createElement('small');
        desc.textContent = playlist.description;
        li.append(desc);
      }
      playlistList.append(li);
    });
  }

  if (providerSelect) {
    providerSelect.innerHTML = '';
    (playlists || []).forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.url;
      opt.textContent = p.provider;
      providerSelect.append(opt);
    });
  }
}

export function showResult(result, meta, type) {
  const {
    resultStatus,
    resultContainer,
    resultTitle,
    resultGenre,
    resultScene,
    resultQuery,
    resultConfidence,
    tagsRow,
    reasonRow,
  } = dom;

  if (resultStatus) {
    resultStatus.textContent = '';
  }
  if (resultContainer) {
    resultContainer.classList.remove('hidden');
  }
  if (resultTitle) {
    resultTitle.textContent = type === 'recommend' ? 'Рекомендованная сцена' : 'Подбор плейлистов';
  }
  if (resultGenre) {
    resultGenre.textContent = `Жанр: ${formatLabel(result.genre)}`;
  }
  if (resultScene) {
    resultScene.textContent = `Сцена: ${formatLabel(result.scene)}`;
  }
  if (resultQuery) {
    resultQuery.textContent = result.query || '';
  }

  renderSceneConfig(meta);
  renderPlaylists(result.playlists || []);
  renderHysteresis(result.hysteresis || {});

  const manualList = Array.isArray(result?.youtube_video_ids)
    ? result.youtube_video_ids.filter((id) => typeof id === 'string' && id.trim())
    : [];
  const hasPlaylistId = typeof result?.youtube_playlist_id === 'string' && result.youtube_playlist_id.trim().length > 0;
  const hasQuery = typeof result?.query === 'string' && result.query.trim().length > 0;

  if (manualList.length || hasPlaylistId || hasQuery) {
    playSearchOnYouTube(result, meta);
  }

  if (meta && meta.volume !== undefined && meta.volume !== null) {
    applyMetaVolume(meta.volume);
  }

  if (Array.isArray(result.tags) && tagsRow) {
    tagsRow.textContent = `Теги: ${result.tags.join(', ')}`;
    tagsRow.classList.remove('hidden');
  } else if (tagsRow) {
    tagsRow.classList.add('hidden');
  }

  if (result.reason && reasonRow) {
    reasonRow.textContent = `Причина: ${result.reason}`;
    reasonRow.classList.remove('hidden');
  } else if (reasonRow) {
    reasonRow.classList.add('hidden');
  }

  if (typeof result.confidence === 'number' && resultConfidence) {
    const percent = Math.round(result.confidence * 100);
    resultConfidence.textContent = `Уверенность: ${percent}%`;
    resultConfidence.classList.remove('hidden');
  } else if (resultConfidence) {
    resultConfidence.classList.add('hidden');
  }

  appendPlayerLog(`Показан результат: ${result.query || 'без запроса'}`, 'debug');
}
