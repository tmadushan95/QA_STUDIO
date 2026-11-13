/**
 * The two short tones that confirm voice started and stopped, synthesised so there is no audio file to ship. A rising
 * pair means "listening", a falling pair means "stopped".
 */
export function playTone(kind: 'start' | 'stop'): void {
  try {
    const ctx = new AudioContext();
    const notes = kind === 'start' ? [660, 880] : [880, 560];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + i * 0.11;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.11);
    });
    setTimeout(() => void ctx.close(), 400);
  } catch {
    // No audio output available: the visual state change still tells the user.
  }
}
