/**
 * Whisper Web Worker
 * 
 * Runs Whisper model in a separate thread to avoid blocking the main UI.
 * Communicates with main thread via postMessage.
 */

// State
let transcriber = null;
let isLoading = false;

// Configuration
const WHISPER_MODEL = 'Xenova/whisper-small';

/**
 * Initialize the Whisper model
 */
async function initModel() {
    if (transcriber || isLoading) return;

    isLoading = true;
    self.postMessage({ type: 'status', message: 'loading', model: WHISPER_MODEL });

    try {
        // Dynamic import works in workers
        const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js');

        transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
            quantized: true,
            progress_callback: (progress) => {
                self.postMessage({
                    type: 'progress',
                    progress: progress.progress || 0,
                    status: progress.status || 'loading'
                });
            }
        });

        self.postMessage({ type: 'status', message: 'ready' });
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    } finally {
        isLoading = false;
    }
}

/**
 * Transcribe audio data
 * @param {Float32Array} audioData - Audio samples at 16kHz
 */
async function transcribe(audioData) {
    if (!transcriber) {
        self.postMessage({ type: 'error', message: 'Model not loaded' });
        return;
    }

    self.postMessage({ type: 'status', message: 'transcribing' });

    try {
        const result = await transcriber(audioData, {
            language: 'russian',
            task: 'transcribe',
        });

        const text = result?.text?.trim() || '';
        self.postMessage({ type: 'result', text });
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    }
}

// Handle messages from main thread
self.onmessage = async (event) => {
    const { type, audioData } = event.data;

    switch (type) {
        case 'init':
            await initModel();
            break;
        case 'transcribe':
            await transcribe(audioData);
            break;
        case 'ping':
            self.postMessage({ type: 'pong' });
            break;
    }
};

// Auto-initialize when worker starts
initModel();
