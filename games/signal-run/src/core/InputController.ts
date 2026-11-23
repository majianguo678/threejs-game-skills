export class InputController {
  private laneDelta = 0;
  private jumpRequested = false;
  private dashRequested = false;
  private pauseRequested = false;
  private readonly buttons = new Map<HTMLElement, (event: Event) => void>();

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') this.laneDelta -= 1;
    if (event.code === 'ArrowRight' || event.code === 'KeyD') this.laneDelta += 1;
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
      this.jumpRequested = true;
      event.preventDefault();
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.dashRequested = true;
    if (event.code === 'Escape' || event.code === 'KeyP') this.pauseRequested = true;
  };

  private readonly clearInput = () => {
    this.laneDelta = 0;
    this.jumpRequested = false;
    this.dashRequested = false;
    this.pauseRequested = false;
  };

  constructor(
    left: HTMLElement,
    right: HTMLElement,
    jump: HTMLElement,
    dash: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('blur', this.clearInput);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.bindButton(left, () => { this.laneDelta -= 1; });
    this.bindButton(right, () => { this.laneDelta += 1; });
    this.bindButton(jump, () => { this.jumpRequested = true; });
    this.bindButton(dash, () => { this.dashRequested = true; });
  }

  consumeLaneDelta(): number {
    const value = Math.sign(this.laneDelta);
    this.laneDelta = 0;
    return value;
  }

  consumeJump(): boolean {
    const value = this.jumpRequested;
    this.jumpRequested = false;
    return value;
  }

  consumeDash(): boolean {
    const value = this.dashRequested;
    this.dashRequested = false;
    return value;
  }

  consumePause(): boolean {
    const value = this.pauseRequested;
    this.pauseRequested = false;
    return value;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('blur', this.clearInput);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    for (const [button, handler] of this.buttons) {
      button.removeEventListener('pointerdown', handler);
      button.removeEventListener('pointerup', this.clearButton);
      button.removeEventListener('pointercancel', this.clearButton);
      button.removeEventListener('lostpointercapture', this.clearButton);
    }
    this.buttons.clear();
  }

  private readonly onVisibilityChange = () => {
    if (document.hidden) this.clearInput();
  };

  private readonly clearButton = (event: Event) => {
    (event.currentTarget as HTMLElement).classList.remove('is-pressed');
  };

  private bindButton(button: HTMLElement, action: () => void): void {
    const handler = (event: Event) => {
      event.preventDefault();
      button.classList.add('is-pressed');
      action();
    };
    button.addEventListener('pointerdown', handler);
    button.addEventListener('pointerup', this.clearButton);
    button.addEventListener('pointercancel', this.clearButton);
    button.addEventListener('lostpointercapture', this.clearButton);
    this.buttons.set(button, handler);
  }
}
