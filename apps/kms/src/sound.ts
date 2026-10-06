const STORAGE_KEY = 'stayx.kms.sound';

/** Remembered "Enable sound" preference. Storage can be blocked; default off. */
export function loadSoundPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveSoundPreference(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // private mode / blocked storage: preference just isn't remembered
  }
}

let context: AudioContext | null = null;

/**
 * Create/resume the AudioContext. Browsers only allow this after a user
 * gesture, so call it from the sound toggle's click handler. Returns false
 * when audio is unavailable or still blocked.
 */
export async function unlockAudio(): Promise<boolean> {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') await context.resume();
    return context.state === 'running';
  } catch {
    return false;
  }
}

/** A short two-tone beep via the Web Audio API (no files, no library). */
export function beep(): void {
  if (!context || context.state !== 'running') return;
  const start = context.currentTime;
  for (const [offset, frequency] of [
    [0, 880],
    [0.18, 1175],
  ] as const) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    // Quick fade in/out avoids clicks.
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, start + offset + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.15);
    osc.connect(gain).connect(context.destination);
    osc.start(start + offset);
    osc.stop(start + offset + 0.16);
  }
}
