export type RunState = 'title' | 'playing' | 'paused' | 'won' | 'failed';

export class Hud {
  private readonly distanceValue = this.getElement('#distance-value');
  private readonly timeValue = this.getElement('#time-value');
  private readonly shardValue = this.getElement('#shard-value');
  private readonly healthValue = this.getElement('#health-value');
  private readonly statusLine = this.getElement('#status-line');
  private readonly overlay = this.getElement('#overlay');
  private readonly overlayKicker = this.getElement('#overlay-kicker');
  private readonly overlayTitle = this.getElement('#overlay-title');
  private readonly overlayCopy = this.getElement('#overlay-copy');
  private readonly primaryAction = this.getElement<HTMLButtonElement>('#primary-action');
  private readonly dashFill = this.getElement<HTMLElement>('#dash-fill');
  private readonly pauseButton = this.getElement<HTMLButtonElement>('#pause-button');
  private readonly muteButton = this.getElement<HTMLButtonElement>('#mute-button');
  private readonly app = this.getElement('#app');
  private readonly buttons = new AbortController();
  private state: RunState = 'title';
  private onStart: () => void = () => {};
  private onPause: () => void = () => {};
  private onMute: () => void = () => {};

  constructor() {
    this.primaryAction.addEventListener('click', () => this.onStart(), { signal: this.buttons.signal });
    this.pauseButton.addEventListener('click', () => this.onPause(), { signal: this.buttons.signal });
    this.muteButton.addEventListener('click', () => this.onMute(), { signal: this.buttons.signal });
  }

  bindActions(actions: { start: () => void; pause: () => void; mute: () => void }): void {
    this.onStart = actions.start;
    this.onPause = actions.pause;
    this.onMute = actions.mute;
  }

  update(distance: number, shards: number, health: number, dashReady: number, secondsLeft: number): void {
    this.distanceValue.textContent = Math.floor(distance).toString().padStart(4, '0');
    this.shardValue.textContent = String(shards).padStart(2, '0');
    this.healthValue.textContent = '◆'.repeat(health) + '◇'.repeat(3 - health);
    this.healthValue.setAttribute('aria-label', `${health} hull points`);
    this.dashFill.style.transform = `scaleX(${dashReady})`;
    this.timeValue.textContent = `00:${Math.ceil(secondsLeft).toString().padStart(2, '0')}`;
  }

  setState(state: RunState): void {
    this.state = state;
    this.overlay.hidden = state === 'playing';
    this.app.dataset.state = state;
    this.pauseButton.disabled = state === 'title' || state === 'won' || state === 'failed';

    if (state === 'title') {
      this.overlayKicker.textContent = 'NIGHT COURIER // ROUTE 08';
      this.overlayTitle.textContent = 'SIGNAL\nRUN';
      this.overlayCopy.textContent = 'Thread the light lanes. Outrun the blackout. Bring the relay shards home.';
      this.primaryAction.textContent = 'START RUN';
      this.statusLine.textContent = 'Route standing by';
    } else if (state === 'paused') {
      this.overlayKicker.textContent = 'RUN PAUSED';
      this.overlayTitle.textContent = 'CATCH\nYOUR BREATH';
      this.overlayCopy.textContent = 'The city can wait one beat.';
      this.primaryAction.textContent = 'RESUME RUN';
      this.statusLine.textContent = 'Paused';
    } else if (state === 'won') {
      this.overlayKicker.textContent = 'DELIVERY COMPLETE';
      this.overlayTitle.textContent = 'SIGNAL\nDELIVERED';
      this.overlayCopy.textContent = 'You made it through the blackout. The next route is yours.';
      this.primaryAction.textContent = 'RUN AGAIN';
      this.statusLine.textContent = 'Relay delivered';
    } else if (state === 'failed') {
      this.overlayKicker.textContent = 'ROUTE INTERRUPTED';
      this.overlayTitle.textContent = 'LIGHTS\nOUT';
      this.overlayCopy.textContent = 'The relay is still out there. Read the hazard, switch lanes, and try again.';
      this.primaryAction.textContent = 'RETRY ROUTE';
      this.statusLine.textContent = 'Hull integrity lost';
    } else {
      this.statusLine.textContent = 'Keep the signal alive';
    }
  }

  setMuted(muted: boolean): void {
    this.muteButton.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
    this.muteButton.setAttribute('aria-pressed', String(muted));
  }

  setHitFeedback(): void {
    this.app.classList.remove('is-hit');
    void this.app.offsetWidth;
    this.app.classList.add('is-hit');
    window.setTimeout(() => this.app.classList.remove('is-hit'), 180);
  }

  get currentState(): RunState {
    return this.state;
  }

  dispose(): void {
    this.buttons.abort();
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
