/**
 * Whisper integration via Transformers.js
 * 
 * Provides browser-based speech-to-text using OpenAI's Whisper model.
 * Falls back to Web Speech API if Whisper is not available.
 */

import { dom } from './state.js';
import { runAutoRecommend } from './search.js';

// State
let transcriber = null;
let isLoading = false;
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

// Configuration
const WHISPER_MODEL = 'Xenova/whisper-tiny';
const CHUNK_DURATION_MS = 8000; // Record 8 seconds at a time

/**
 * Initialize Whisper model asynchronously
 * @returns {Promise<boolean>} True if initialization succeeded
 */
export async function initWhisper() {
  if (transcriber) return true;
  if (isLoading) return false;

  const { whisperStatus } = dom;

  try {
    isLoading = true;
    if (whisperStatus) {
      whisperStatus.textContent = 'Загружаем Whisper-модель (~40MB)...';
    }

    // Dynamic import of Transformers.js
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');

    transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      quantized: true, // Use quantized model for faster loading
    });

    if (whisperStatus) {
      whisperStatus.textContent = 'Whisper готов к работе!';
    }
    return true;
  } catch (error) {
    console.error('Failed to load Whisper:', error);
    if (whisperStatus) {
      whisperStatus.textContent = 'Whisper недоступен. Используем Web Speech API.';
    }
    return false;
  } finally {
    isLoading = false;
  }
}

/**
 * Check if Whisper is ready
 */
export function isWhisperReady() {
  return transcriber !== null;
}

/**
 * Transcribe audio blob using Whisper
 * @param {Blob} audioBlob - Audio data to transcribe
 * @returns {Promise<string|null>} Transcribed text or null on failure
 */
export async function transcribeAudio(audioBlob) {
  if (!transcriber) {
    console.warn('Whisper not initialized');
    return null;
  }

  try {
    // Convert blob to array buffer
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Transcribe
    const result = await transcriber(arrayBuffer, {
      language: 'russian', // Default to Russian for DnD sessions
      task: 'transcribe',
    });

    return result?.text?.trim() || null;
  } catch (error) {
    console.error('Transcription failed:', error);
    return null;
  }
}

/**
 * Start recording audio for transcription
 */
export async function startRecording() {
  if (isRecording) return;

  const { whisperStatus } = dom;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000, // Whisper expects 16kHz
      }
    });

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      if (audioChunks.length === 0) return;

      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      audioChunks = [];

      if (whisperStatus) {
        whisperStatus.textContent = 'Распознаём речь...';
      }

      const text = await transcribeAudio(audioBlob);

      if (text) {
        if (whisperStatus) {
          whisperStatus.textContent = `Распознано: "${text.substring(0, 50)}..."`;
        }
        // Send to backend for scene recommendation
        await sendToBackend(text);
      } else if (whisperStatus) {
        whisperStatus.textContent = 'Не удалось распознать речь.';
      }

      // Continue recording if still active
      if (isRecording) {
        startNextChunk();
      }
    };

    isRecording = true;
    startNextChunk();

    if (whisperStatus) {
      whisperStatus.textContent = 'Слушаю... (Whisper)';
    }
  } catch (error) {
    console.error('Failed to start recording:', error);
    if (whisperStatus) {
      whisperStatus.textContent = `Ошибка микрофона: ${error.message}`;
    }
  }
}

/**
 * Start recording next audio chunk
 */
function startNextChunk() {
  if (!mediaRecorder || !isRecording) return;

  mediaRecorder.start();

  // Stop after CHUNK_DURATION_MS to process
  setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }, CHUNK_DURATION_MS);
}

/**
 * Stop recording
 */
export function stopRecording() {
  isRecording = false;

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }

  if (mediaRecorder?.stream) {
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
  }

  mediaRecorder = null;

  const { whisperStatus } = dom;
  if (whisperStatus) {
    whisperStatus.textContent = 'Whisper остановлен.';
  }
}

/**
 * Send transcribed text to backend for recommendation
 * @param {string} text - Transcribed speech text
 */
async function sendToBackend(text) {
  const genreSelect = document.getElementById('genre-select');
  const genre = genreSelect?.value || 'fantasy';

  try {
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        genre,
        tags: [],
        raw_text: text,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      // Trigger UI update with the recommendation
      runAutoRecommend([result.scene]);
    }
  } catch (error) {
    console.error('Failed to send to backend:', error);
  }
}

/**
 * Initialize Whisper toggle button
 */
export function initWhisperToggle() {
  const { whisperToggle, whisperStatus } = dom;
  if (!whisperToggle) return;

  whisperToggle.addEventListener('click', async () => {
    if (isRecording) {
      stopRecording();
      whisperToggle.textContent = '🎤 Включить Whisper';
      return;
    }

    // Try to initialize Whisper first
    const ready = await initWhisper();

    if (ready) {
      await startRecording();
      whisperToggle.textContent = '⏹ Остановить Whisper';
    } else {
      // Fallback message
      if (whisperStatus) {
        whisperStatus.textContent = 'Whisper недоступен. Используйте кнопку микрофона для Web Speech API.';
      }
    }
  });

  if (whisperStatus) {
    whisperStatus.textContent = 'Whisper: нажмите кнопку для активации.';
  }
}
