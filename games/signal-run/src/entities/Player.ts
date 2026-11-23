import * as THREE from 'three';

const LANES = [-3.05, 0, 3.05];
const JUMP_DURATION = 0.76;

export type PlayerTuning = {
  speed: number;
  dashMultiplier: number;
  acceleration: number;
};

export class Player {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3(0, 0.22, 3.2);
  lane = 1;
  dashTime = 0;
  dashCooldown = 0;
  private jumpTime = 0;
  private readonly hull = new THREE.MeshStandardMaterial({
    color: '#eaf5f2',
    metalness: 0.64,
    roughness: 0.28,
  });
  private readonly teal = new THREE.MeshStandardMaterial({
    color: '#68e6d3',
    metalness: 0.38,
    roughness: 0.3,
    emissive: '#0d756b',
    emissiveIntensity: 1.15,
  });
  private readonly canopy = new THREE.MeshPhysicalMaterial({
    color: '#183d4e',
    metalness: 0.32,
    roughness: 0.12,
    clearcoat: 0.9,
    emissive: '#0b3440',
    emissiveIntensity: 0.8,
  });
  private readonly engineMaterial = new THREE.MeshBasicMaterial({ color: '#ffb766' });
  private readonly parts: THREE.Object3D[] = [];

  constructor(
    private readonly hullGeometry: THREE.BufferGeometry,
    private readonly wingGeometry: THREE.BufferGeometry,
    private readonly engineGeometry: THREE.BufferGeometry,
    private readonly canopyGeometry: THREE.BufferGeometry,
    private readonly engineGlowGeometry: THREE.BufferGeometry,
  ) {
    this.buildCraft();
    this.group.position.copy(this.position);
  }

  get isAirborne(): boolean {
    return this.jumpTime > 0;
  }

  get isDashing(): boolean {
    return this.dashTime > 0;
  }

  changeLane(direction: number): void {
    this.lane = THREE.MathUtils.clamp(this.lane + direction, 0, LANES.length - 1);
  }

  jump(): boolean {
    if (this.jumpTime > 0) return false;
    this.jumpTime = JUMP_DURATION;
    return true;
  }

  dash(): boolean {
    if (this.dashCooldown > 0) return false;
    this.dashTime = 0.52;
    this.dashCooldown = 3.2;
    return true;
  }

  update(delta: number, elapsed: number, speed: number): void {
    this.jumpTime = Math.max(0, this.jumpTime - delta);
    this.dashTime = Math.max(0, this.dashTime - delta);
    this.dashCooldown = Math.max(0, this.dashCooldown - delta);

    const targetX = LANES[this.lane];
    this.position.x = THREE.MathUtils.damp(this.position.x, targetX, 13, delta);
    const jumpProgress = this.jumpTime > 0 ? 1 - this.jumpTime / JUMP_DURATION : 1;
    this.position.y = 0.22 + (this.jumpTime > 0 ? Math.sin(jumpProgress * Math.PI) * 1.85 : 0);
    this.group.position.copy(this.position);
    this.group.rotation.z = THREE.MathUtils.clamp((targetX - this.position.x) * -0.075, -0.16, 0.16);
    this.group.rotation.x = Math.sin(elapsed * 5) * 0.018;

    const enginePulse = 0.88 + Math.sin(elapsed * 17) * 0.12 + Math.min(speed / 40, 0.25);
    for (let i = 0; i < this.parts.length; i += 1) {
      this.parts[i].scale.setScalar(enginePulse);
    }
    this.teal.emissiveIntensity = this.isDashing ? 3.2 : 1.15;
  }

  reset(): void {
    this.lane = 1;
    this.jumpTime = 0;
    this.dashTime = 0;
    this.dashCooldown = 0;
    this.position.set(0, 0.22, 3.2);
    this.group.position.copy(this.position);
    this.group.rotation.set(0, 0, 0);
  }

  dispose(): void {
    this.hull.dispose();
    this.teal.dispose();
    this.canopy.dispose();
    this.engineMaterial.dispose();
  }

  private buildCraft(): void {
    const body = new THREE.Mesh(this.hullGeometry, this.hull);
    body.scale.set(0.7, 0.3, 1.15);
    body.position.y = 0.1;
    body.castShadow = true;
    this.group.add(body);

    const prow = new THREE.Mesh(this.engineGlowGeometry, this.hull);
    prow.rotation.x = -Math.PI / 2;
    prow.scale.set(3, 1.4, 1.2);
    prow.position.set(0, 0.12, -0.75);
    this.group.add(prow);

    const wing = new THREE.Mesh(this.wingGeometry, this.hull);
    wing.scale.set(1, 0.22, 1);
    wing.position.y = 0.08;
    this.group.add(wing);

    const cockpit = new THREE.Mesh(this.canopyGeometry, this.canopy);
    cockpit.scale.set(0.36, 0.23, 0.53);
    cockpit.position.set(0, 0.31, -0.05);
    this.group.add(cockpit);

    for (const side of [-1, 1]) {
      const engine = new THREE.Mesh(this.engineGeometry, this.hull);
      engine.rotation.x = Math.PI / 2;
      engine.position.set(side * 0.47, 0.04, 0.58);
      engine.scale.set(0.16, 0.16, 0.56);
      this.group.add(engine);

      const glow = new THREE.Mesh(this.engineGlowGeometry, this.engineMaterial);
      glow.rotation.x = Math.PI / 2;
      glow.position.set(side * 0.47, 0.04, 0.97);
      glow.scale.set(0.115, 0.115, 0.38);
      this.group.add(glow);

      const fin = new THREE.Mesh(this.wingGeometry, this.teal);
      fin.scale.set(0.25, 0.11, 0.32);
      fin.position.set(side * 0.74, 0.12, 0.32);
      fin.rotation.y = side * -0.08;
      this.group.add(fin);
      this.parts.push(glow);
    }
  }
}
