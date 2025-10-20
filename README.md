# DnD Music Tool

Автономный бэкенд-сервис для подбора музыкальных плейлистов под сцену и жанр ролевой игры. Реализует API из технического задания, поддерживает нейросетевой выбор сцен и может использоваться фронтендом как источник подходящих ссылок на музыку.

## Возможности
- Загрузка конфигурации сцен и жанров из YAML-файла.
- Возврат поискового запроса и подготовленных ссылок на провайдеров плейлистов для каждой сцены.
- Интеграция с внешним нейросетевым сервисом для автоматического выбора сцены по тегам.
- Расширенный каталог жанров и сценариев (фэнтези, стимпанк, хоррор, космооперы, пиратские истории, постапокалипсис и др.).
- Учет параметров антидребезга (hysteresis) из конфигурации.
- In-memory кэширование результатов на время, заданное в конфиге.
- REST API, совместимое с Railway (FastAPI).

## Запуск
```bash
pip install -e .[dev]

# локальный запуск с автообновлением
UVICORN_RELOAD=1 python -m app
```

Для прямой интеграции с YouTube задайте ключ Data API (v3) до запуска сервиса:

```bash
export YOUTUBE_API_KEY="ваш-ключ"
# Опционально укажите код страны для проверки региональных ограничений
export YOUTUBE_API_REGION="RU"
```

По умолчанию используется конфигурация `config/default.yaml`. Чтобы подключить другой файл, задайте переменную окружения `MUSIC_CONFIG_PATH`:

```bash
MUSIC_CONFIG_PATH=./config/custom.yaml python -m app
```

### Деплой на Render (и похожих PaaS)

Render передаёт порт через переменную окружения `PORT`. Скрипт `python -m app`
поднимет uvicorn на `0.0.0.0:$PORT`, поэтому в настройках сервиса укажите
команду запуска:

```bash
python -m app
```

При необходимости дополнительно задайте переменные окружения, например
`MUSIC_CONFIG_PATH`.

## API
### Поиск сцены вручную
```http
GET /api/search?genre=fantasy&scene=battle
```

### Автоподбор сцены по тегам
```http
POST /api/recommend
{
  "genre": "fantasy",
  "tags": ["battle", "dragons"]
}
```

Ответ содержит ту же структуру, что и `/api/search`, но дополнительно возвращает теги, уверенность модели и (если доступно) пояснение выбора.

### Пример ответа
```json
{
  "genre": "fantasy",
  "scene": "battle",
  "query": "epic fantasy battle instrumental -vocals",
  "video_ids": [
    "a1B2c3D4e5F",
    "x6Y7z8W9v0U"
  ],
  "playlists": [
    {
      "provider": "youtube_music",
      "url": "https://music.youtube.com/search?q=epic+fantasy+battle+instrumental+-vocals",
      "description": "Поиск на YouTube Music"
    },
    {
      "provider": "spotify",
      "url": "https://open.spotify.com/search/epic+fantasy+battle+instrumental+-vocals",
      "description": "Поиск в Spotify"
    }
  ],
  "tags": ["battle", "dragons"],
  "confidence": 0.91,
  "reason": "stub",
  "hysteresis": {
    "min_confidence": 0.6,
    "window_sec": 30,
    "cooldown_sec": 75
  }
}
```

## Переменные окружения
- `MUSIC_CONFIG_PATH` — путь к YAML-конфигу с жанрами и сценами.
- `MUSIC_AI_ENDPOINT` — полный URL эндпоинта нейросетевого сервиса рекомендаций.
- `MUSIC_AI_TOKEN` — опциональный Bearer-токен для авторизации при обращении к нейросети.
- `MUSIC_AI_TIMEOUT` — таймаут (в секундах) для обращения к нейросети, по умолчанию 30.
- `YOUTUBE_API_KEY` — ключ YouTube Data API v3 для подбора конкретных видеороликов.
- `YOUTUBE_API_REGION` — ISO-код страны (например, `RU`), чтобы учитывать региональные ограничения YouTube.

## Тесты
```bash
pytest
```
