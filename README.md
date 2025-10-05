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
uvicorn app.api:app --reload
```

По умолчанию используется конфигурация `config/default.yaml`. Чтобы подключить другой файл, задайте переменную окружения `MUSIC_CONFIG_PATH`:

```bash
MUSIC_CONFIG_PATH=./config/custom.yaml uvicorn app.api:app
```

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

## Тесты
```bash
pytest
```
