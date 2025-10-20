import { dom, initialData, state, formatLabel } from './state.js';

export function populateGenres(select) {
  if (!select) {
    return;
  }

  select.innerHTML = '';
  let matched = false;
  initialData.genres.forEach((genre, index) => {
    const option = document.createElement('option');
    option.value = genre;
    option.textContent = formatLabel(genre);
    if (!state.genre && index === 0) {
      state.genre = genre;
    }
    if (genre === state.genre) {
      option.selected = true;
      matched = true;
    }
    select.append(option);
  });

  if (!matched && initialData.genres.length) {
    select.selectedIndex = 0;
    state.genre = select.value;
  }
}

export function getSceneMeta(genre, scene) {
  const list = initialData.scenes?.[genre] || [];
  return list.find((entry) => entry.id === scene) || null;
}

export function populateScenes(genre) {
  const { sceneSelect } = dom;
  if (!sceneSelect) {
    return;
  }

  const scenes = initialData.scenes?.[genre] || [];
  sceneSelect.innerHTML = '';

  if (!scenes.length) {
    state.scene = null;
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Нет сцен';
    option.selected = true;
    sceneSelect.append(option);
    return;
  }

  let matched = false;
  scenes.forEach((scene, index) => {
    const option = document.createElement('option');
    option.value = scene.id;
    option.textContent = scene.name;
    if (!state.scene && index === 0) {
      state.scene = scene.id;
    }
    if (scene.id === state.scene) {
      option.selected = true;
      matched = true;
    }
    sceneSelect.append(option);
  });

  if (!matched && scenes.length) {
    state.scene = scenes[0].id;
    sceneSelect.value = state.scene;
  }
}

export function renderSceneButtons(genre, onSceneSelected) {
  const { sceneButtonsWrap, sceneSelect } = dom;
  if (!sceneButtonsWrap) {
    return;
  }

  sceneButtonsWrap.innerHTML = '';
  const scenes = initialData.scenes?.[genre] || [];
  scenes.forEach((scene) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scene-chip' + (scene.id === state.scene ? ' active' : '');
    button.dataset.scene = scene.id;
    button.textContent = scene.name;
    button.addEventListener('click', () => {
      state.scene = scene.id;
      if (sceneSelect) {
        sceneSelect.value = scene.id;
      }
      updateSceneButtonsHighlight();
      if (typeof onSceneSelected === 'function') {
        onSceneSelected(scene.id);
      }
    });
    sceneButtonsWrap.append(button);
  });
  updateSceneButtonsHighlight();
}

export function updateSceneButtonsHighlight() {
  document.querySelectorAll('.scene-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.scene === state.scene);
  });
}
