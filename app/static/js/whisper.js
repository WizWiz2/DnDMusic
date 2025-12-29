/**
 * Whisper integration via Web Worker + Transformers.js
 * 
 * Runs Whisper model in a separate thread to avoid blocking the main UI.
 * Falls back to Web Speech API if Whisper is not available.
 */

import { dom, logRecognition } from './state.js';
import { runAutoRecommend } from './search.js';

// State
let worker = null;
let isLoading = false;
let isReady = false;
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

// Configuration
const CHUNK_DURATION_MS = 8000; // Record 8 seconds at a time

/**
 * Initialize Whisper worker
 * @returns {Promise<boolean>} True if initialization succeeded
 */
export async function initWhisper() {
  if (isReady) return true;
  if (isLoading) return false;

  try {
    isLoading = true;
    logRecognition('🧠 Запускаем Whisper Worker...', 'info');

    // Create worker as Module Worker for ES imports
    worker = new Worker('/static/js/whisper-worker.js', { type: 'module' });

    // Handle messages from worker
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (error) => {
      logRecognition(`❌ Worker error: ${error.message}`, 'error');
    };

    // Wait for worker to be ready (with timeout)
    const ready = await waitForWorkerReady(60000); // 60 sec timeout for model loading

    if (ready) {
      isReady = true;
      logRecognition('✅ Whisper готов к работе!', 'output');
      return true;
    } else {
      logRecognition('❌ Таймаут загрузки Whisper', 'error');
      return false;
    }
  } catch (error) {
    console.error('Failed to init Whisper worker:', error);
    logRecognition(`❌ Whisper недоступен: ${error.message}`, 'error');
    return false;
  } finally {
    isLoading = false;
  }
}

/**
 * Wait for worker to signal ready state
 */
function waitForWorkerReady(timeoutMs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);

    const checkReady = (event) => {
      const { type, message, progress, status } = event.data;

      if (type === 'status' && message === 'loading') {
        logRecognition('🧠 Загружаем Whisper-модель (~240MB)...', 'info');
      }

      if (type === 'progress' && progress !== undefined) {
        const pct = Math.round(progress);
        if (pct > 0 && pct % 20 === 0) { // Log every 20%
          logRecognition(`📥 Загрузка: ${pct}%`, 'info');
        }
      }

      if (type === 'status' && message === 'ready') {
        clearTimeout(timeout);
        worker.removeEventListener('message', checkReady);
        resolve(true);
      }

      if (type === 'error') {
        clearTimeout(timeout);
        worker.removeEventListener('message', checkReady);
        logRecognition(`❌ Ошибка: ${event.data.message}`, 'error');
        resolve(false);
      }
    };

    worker.addEventListener('message', checkReady);
  });
}

/**
 * Handle messages from worker
 */
function handleWorkerMessage(event) {
  const { type, text, message } = event.data;

  switch (type) {
    case 'status':
      if (message === 'transcribing') {
        logRecognition('🔄 Распознаём речь (Whisper)...', 'info');
      }
      break;

    case 'result':
      if (text) {
        logRecognition(`📝 Whisper: "${text}"`, 'input');
        sendToBackend(text);
      } else {
        logRecognition('⚠️ Whisper: пустой результат', 'info');
      }
      break;

    case 'error':
      logRecognition(`❌ Whisper ошибка: ${message}`, 'error');
      break;
  }
}

/**
 * Check if Whisper is ready
 */
export function isWhisperReady() {
  return isReady && worker !== null;
}

/**
 * Convert audio blob to Float32Array at 16kHz for Whisper
 */
async function convertBlobToAudioData(blob) {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
    });

    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Get mono channel
    const channelData = audioBuffer.getChannelData(0);

    // Resample to 16kHz if needed
    if (audioBuffer.sampleRate !== 16000) {
      const ratio = audioBuffer.sampleRate / 16000;
      const newLength = Math.round(channelData.length / ratio);
      const resampled = new Float32Array(newLength);
      for (let i = 0; i < newLength; i++) {
        resampled[i] = channelData[Math.round(i * ratio)];
      }
      await audioContext.close();
      return resampled;
    }

    await audioContext.close();
    return channelData;
  } catch (error) {
    console.error('Audio conversion failed:', error);
    return null;
  }
}

/**
 * Start recording audio for transcription
 */
export async function startRecording() {
  if (isRecording) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
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

      // Convert to Float32Array
      const audioData = await convertBlobToAudioData(audioBlob);

      if (audioData && worker) {
        // Send to worker for transcription (non-blocking!)
        worker.postMessage({ type: 'transcribe', audioData });
      }

      // Continue recording if still active
      if (isRecording) {
        startNextChunk();
      }
    };

    isRecording = true;
    startNextChunk();

    logRecognition('🧠 Whisper слушает...', 'info');
  } catch (error) {
    console.error('Failed to start recording:', error);
    logRecognition(`❌ Ошибка микрофона: ${error.message}`, 'error');
  }
}

/**
 * Start recording next audio chunk
 */
function startNextChunk() {
  if (!mediaRecorder || !isRecording) return;

  mediaRecorder.start();

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

  logRecognition('⏹ Whisper остановлен', 'info');
}

/**
 * Send transcribed text to backend for recommendation
 * @param {string} text - Transcribed speech text
 */
async function sendToBackend(text) {
  const genreSelect = document.getElementById('genre-select');
  const genre = genreSelect?.value || 'fantasy';

  try {
    logRecognition(`🚀 Отправляем в AI: "${text.substring(0, 50)}..."`, 'decision');

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
      logRecognition(`✅ AI рекомендует: ${result.scene}`, 'output');
      runAutoRecommend([result.scene]);
    } else {
      const error = await response.text();
      logRecognition(`❌ API ошибка: ${error.substring(0, 100)}`, 'error');
    }
  } catch (error) {
    console.error('Failed to send to backend:', error);
    logRecognition(`❌ Сетевая ошибка: ${error.message}`, 'error');
  }
}

/**
 * Toggle Whisper recording (for UI button)
 */
export function initWhisperToggle() {
  const { whisperToggle } = dom;
  if (!whisperToggle) return;

  whisperToggle.addEventListener('click', async () => {
    if (isRecording) {
      stopRecording();
      whisperToggle.textContent = '🧠 Whisper';
    } else {
      // Initialize if not ready
      if (!isReady) {
        whisperToggle.textContent = '⏳ Загрузка...';
        const ok = await initWhisper();
        if (!ok) {
          whisperToggle.textContent = '🧠 Whisper';
          return;
        }
      }

      await startRecording();
      whisperToggle.textContent = '⏹ Стоп Whisper';
    }
  });
}
