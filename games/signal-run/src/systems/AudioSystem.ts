export class AudioSystem {
  private context: AudioContext | null = null;
  private muted = false;

  async unlock(): Promise<void> {
    if (!this.context) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      this.context = new AudioContextClass();
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  pickup(): void {
    this.tone(620, 960, 0.13, 'sine', 0.075);
  }

  jump(): void {
    this.tone(210, 420, 0.18, 'triangle', 0.055);
  }

  dash(): void {
    this.tone(130, 560, 0.24, 'sawtooth', 0.04);
  }

  hit(): void {
    this.tone(110, 48, 0.32, 'square', 0.07);
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
  ): void {
    if (this.muted || !this.context || this.context.state !== 'running') return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
