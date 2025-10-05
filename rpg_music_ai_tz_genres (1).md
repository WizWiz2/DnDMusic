# 🎵 ТЗ: Автоматическая музыка под настроение для ролевых игр (с жанрами)

## 🔮 Идея
Сервис слушает речь за игровым столом (онлайн/оффлайн), распознаёт текст, определяет «сцену» (бой, таверна, исследование, напряжение, отдых) **и учитывает жанр игры** (фэнтези, киберпанк, sci-fi, хоррор).  
Дальше автоматически включает подходящую музыку из бесплатных источников.

---

## 🏗 Архитектура

### Фронтенд (браузер, PWA)
- Доступ к микрофону через `getUserMedia`.
- Транскрибация речи локально (без API-затрат):  
  - **whisper.cpp (WASM)** или **xenova/whisper-webgpu**.
- Классификатор сцены:  
  - v1: правила/ключевые слова;  
  - v2: лёгкая LLM (WebGPU).
- Пользователь задаёт **жанр игры** (Fantasy, Cyberpunk, Sci-fi, Horror).  
- Воспроизведение музыки прямо в браузере:  
  - **YouTube IFrame API**,  
  - **Pixabay Music / Free Music Archive / Jamendo**,  
  - **Audius**,  
  - или собственные MP3/OGG-файлы на GitHub Pages/Cloudflare.  
- Логика «антидребезга»: окно 30–45 с, cooldown 60–90 с, кроссфейд при смене трека.

### Бэкенд (Railway, бесплатный тариф)
- Тонкий API:  
  - Принимает тег сцены и жанр → ищет треки в бесплатных источниках.  
  - Кэширует результаты (Redis/in-memory) на 10–30 минут.  
  - Отдаёт список кандидатов фронтенду.
- Не воспроизводит музыку, только поиск и метаданные.

---

## ⚙️ Алгоритм работы
1. Микрофон → транскрибация (Whisper).  
2. Классификация текста → тег сцены.  
3. Фронтенд добавляет выбранный жанр.  
4. Отправка `scene+genre` на Railway API.  
5. API ищет и возвращает список треков (YouTube/Audio/MP3).  
6. Фронтенд включает первый подходящий (с проверкой длины/качества).  
7. Антидребезг контролирует частоту смены треков.  
8. При смене сцены музыка плавно переключается (кроссфейд, громкость).  

---

## 🔑 Примеры запросов по сценам и жанрам

### Fantasy
- **Battle**: `epic fantasy battle instrumental -vocals`  
- **Tavern**: `medieval tavern lute folk instrumental -vocals`  
- **Exploration**: `fantasy dungeon forest ambient instrumental -vocals`  

### Cyberpunk
- **Battle**: `cyberpunk combat synthwave instrumental -vocals`  
- **Tavern/Bar**: `cyberpunk bar neon synth lounge instrumental -vocals`  
- **Exploration**: `cyberpunk city ambient neon instrumental -vocals`  

### Sci-fi
- **Battle**: `space opera battle orchestral instrumental -vocals`  
- **Exploration**: `sci fi ambient exploration instrumental -vocals`  

### Horror
- **Tension**: `dark horror suspense ambient drone instrumental -vocals`  
- **Exploration**: `creepy dungeon ambient instrumental -vocals`  

Фильтры:  
- Мин. длительность 90 сек, макс. 10 мин.  
- Исключить `-vocals -lyrics -cover -live`.  

---

## 🎛 Конфиг (пример YAML)
```yaml
genres:
  fantasy:
    BATTLE:
      query: "epic fantasy battle instrumental -vocals"
      volume: 85
      crossfade: 3
    TAVERN:
      query: "medieval tavern lute instrumental -vocals"
      volume: 70
      crossfade: 5
  cyberpunk:
    BATTLE:
      query: "cyberpunk combat synthwave instrumental -vocals"
      volume: 85
      crossfade: 3
    TAVERN:
      query: "cyberpunk bar synth lounge instrumental -vocals"
      volume: 70
      crossfade: 5

hysteresis:
  min_confidence: 0.6
  window_sec: 30
  cooldown_sec: 75
```

---

## 🛠 Технологии
- **Фронтенд**: React/Vue/Next.js + Whisper WASM/WebGPU + YouTube IFrame API.  
- **Бэкенд (Railway)**: Node.js/Python (FastAPI/Express), API-прокси к YouTube/Pixabay/Jamendo.  
- **Кэш**: Redis (Railway free), или in-memory store.  
- **Деплой**: Railway (бесплатный тариф).  

---

## 🚀 MVP (за вечер)
- Фронтенд: микрофон → Whisper (tiny) → ключевые слова → тег сцены → + жанр → запрос в API → проигрывание YouTube.  
- Бэкенд: `/api/search?genre=fantasy&scene=Battle` → список ссылок YouTube.  
- Антидребезг + ручные кнопки override.

---

## 📌 Улучшения
- Жёсткие триггеры: мгновенный свитч по словам «инициатива», «атакую», «ловушка».  
- Поддержка нескольких источников музыки.  
- Обучаемый классификатор (распознаёт сеттинг по ключевым словам, подбирает жанр сам).  
- Интеграция с Foundry/Discord (webhook → тег сцены).  
- PWA-режим с оффлайн-кэшем треков и моделей.
