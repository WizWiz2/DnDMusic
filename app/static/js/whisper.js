/**
 * Whisper integration via Transformers.js
 * 
 * Provides browser-based speech-to-text using OpenAI's Whisper model.
 * Falls back to Web Speech API if Whisper is not available.
 */

import { dom, logRecognition } from './state.js';
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
    logRecognition('🧠 Загружаем Whisper-модель (~40MB)...', 'info');

    // Dynamic import of Transformers.js
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');

    transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      quantized: true, // Use quantized model for faster loading
    });

    logRecognition('✅ Whisper готов к работе!', 'output');
    return true;
  } catch (error) {
    console.error('Failed to load Whisper:', error);
    logRecognition(`❌ Whisper недоступен: ${error.message}`, 'error');
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
    // Convert WebM to Float32Array using AudioContext
    const audioData = await convertBlobToAudioData(audioBlob);
    if (!audioData) {
      console.error('Failed to convert audio');
      return null;
    }

    // Transcribe with proper audio format
    const result = await transcriber(audioData, {
      language: 'russian',
      task: 'transcribe',
    });

    console.log('Whisper result:', result);
    return result?.text?.trim() || null;
  } catch (error) {
    console.error('Transcription failed:', error);
    return null;
  }
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

      logRecognition('🔄 Распознаём речь (Whisper)...', 'info');

      const text = await transcribeAudio(audioBlob);

      if (text) {
        logRecognition(`📝 Whisper вход: "${text}"`, 'input');
        // Send to backend for scene recommendation
        await sendToBackend(text);
      } else {
        logRecognition('⚠️ Whisper: не удалось распознать речь', 'error');
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
