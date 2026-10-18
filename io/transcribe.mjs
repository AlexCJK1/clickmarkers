// Voice notes to text, on the machine, no key: Telegram's OGG/Opus is decoded with ogg-opus-decoder,
// resampled to 16 kHz mono, and read by a Whisper model through @huggingface/transformers (ONNX on the
// CPU). Both packages are optional dependencies: where they did not install, the phone says so and
// asks for typed text. The model (whisper-base, about 150 MB) downloads once into data/models.
// An OpenAI Whisper route stays available when OPENAI_API_KEY is set and telegram.transcribe is "openai".
import path from 'node:path';
import { log } from '../core/events.mjs';

let asr = null, loading = null;

export async function available() {
  try { await import('ogg-opus-decoder'); await import('@huggingface/transformers'); return true; } catch { return false; }
}

async function decodeOgg(buffer) {
  const { OggOpusDecoder } = await import('ogg-opus-decoder');
  const d = new OggOpusDecoder(); await d.ready;
  const { channelData, samplesDecoded, sampleRate } = d.decode(new Uint8Array(buffer));
  d.free();
  const n = samplesDecoded; const ch = channelData.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) s += channelData[c][i]; mono[i] = s / ch; }
  return resample(mono, sampleRate, 16000);
}
function resample(x, from, to) {
  if (from === to) return x;
  const ratio = from / to; const n = Math.floor(x.length / ratio); const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * ratio; const i0 = Math.floor(p); const i1 = Math.min(i0 + 1, x.length - 1); const f = p - i0; y[i] = x[i0] * (1 - f) + x[i1] * f; }
  return y;
}
async function model(cfg) {
  if (asr) return asr;
  if (!loading) loading = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = path.join(cfg.data, 'models'); env.allowLocalModels = true;
    const name = cfg.telegram?.whisper || 'onnx-community/whisper-base';
    log.info(`voice: loading ${name} (first time downloads the model)`);
    asr = await pipeline('automatic-speech-recognition', name, { dtype: 'q8' });
    return asr;
  })();
  return loading;
}

/** OGG/Opus bytes → text. Throws when the packages are missing. */
export async function transcribeLocal(buffer, cfg) {
  const audio = await decodeOgg(buffer);
  const m = await model(cfg);
  const out = await m(audio, { language: cfg.telegram?.language || 'english', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: false });
  return String(out?.text || '').trim();
}
