import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { Player } from '../entities/Player';
import { AudioSystem } from '../systems/AudioSystem';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud, type RunState } from '../systems/Hud';
import { createSeededRandom } from '../utils/random';

const LANE_X = [-3.05, 0, 3.05];
const RUN_DURATION = 55;
const ROAD_LENGTH = 112;
const SPAWN_Z = -34;

type HazardKind = 'barrier' | 'gate' | 'drone';

type Hazard = {
  group: THREE.Group;
  lane: number;
  kind: HazardKind;
  resolved: boolean;
  phase: number;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
};

type Shard = {
  group: THREE.Group;
  lane: number;
  phase: number;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
};

type MovingInstances = {
  mesh: THREE.InstancedMesh;
  z: number[];
  x: number[];
  scale: THREE.Vector3[];
  length: number;
  speedFactor: number;
};

type Burst = {
  group: THREE.Group;
  life: number;
  material: THREE.MeshBasicMaterial;
  geometry: THREE.BufferGeometry;
};

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(54, 1, 0.1, 180);
  private readonly input: InputController;
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );
  private readonly tuning: DebugTuning = {
    speed: 13,
    dashMultiplier: 1.65,
    acceleration: 13,
    cameraLag: 0.16,
    exposure: 1.16,
    maxDpr: 1.75,
  };
  private readonly debugTools: DebugTools;
  private rng = createSeededRandom(17);
  private readonly materials = new Set<THREE.Material>();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly hazards: Hazard[] = [];
  private readonly shards: Shard[] = [];
  private readonly effects: Burst[] = [];
  private readonly movingInstances: MovingInstances[] = [];
  private readonly player: Player;
  private readonly frameDummy = new THREE.Object3D();
  private readonly dashTrail: THREE.Mesh;
  private state: RunState = 'title';
  private frame = 0;
  private elapsed = 0;
  private distance = 0;
  private shardCount = 0;
  private health = 3;
  private spawnTimer = 1.7;
  private shardTimer = 1.05;
  private invulnerability = 0;
  private hitTrauma = 0;
  private muted = false;
  private pausedForScreenshot = false;
  private reducedMotion = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = this.tuning.exposure;

    this.input = new InputController(
      this.getElement('#left-button'),
      this.getElement('#right-button'),
      this.getElement('#jump-button'),
      this.getElement('#dash-button'),
    );

    this.player = new Player(
      this.geometry(new THREE.IcosahedronGeometry(1, 1)),
      this.geometry(this.createWingGeometry()),
      this.geometry(new THREE.CylinderGeometry(0.19, 0.24, 0.9, 12, 1)),
      this.geometry(new THREE.SphereGeometry(1, 20, 12)),
      this.geometry(new THREE.ConeGeometry(0.13, 0.52, 12)),
    );

    this.dashTrail = new THREE.Mesh(
      this.geometry(new THREE.CapsuleGeometry(0.24, 1.8, 4, 8)),
      this.material(new THREE.MeshBasicMaterial({
        color: '#58e8d1',
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      })),
    );
    this.dashTrail.rotation.x = Math.PI / 2;
    this.dashTrail.visible = false;

    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    });

    this.createWorld();
    this.scene.add(this.player.group, this.dashTrail);
    this.hud.bindActions({
      start: () => this.startRun(),
      pause: () => this.togglePause(),
      mute: () => this.toggleMute(),
    });
    this.hud.setState('title');
    this.updateHud();
    this.installTestHooks();
    this.publishDiagnostics();
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
  }

  private disposeOwnedGroup(
    group: THREE.Group,
    geometries: THREE.BufferGeometry[],
    materials: THREE.Material[],
  ): void {
    this.scene.remove(group);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.debugTools.dispose();
    this.hud.dispose();
    this.player.dispose();
    for (const texture of this.textures) texture.dispose();
    for (const material of this.materials) material.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }

    const visualDelta = this.reducedMotion ? 0 : delta;
    if (this.input.consumePause()) this.togglePause();
    if (this.state === 'playing') this.updateRun(delta);
    this.updateWorld(visualDelta, elapsed);
    this.updateEffects(visualDelta);
    this.updateHud();
    this.publishDiagnostics();
  }

  private updateRun(delta: number): void {
    this.elapsed += delta;
    const speed = this.tuning.speed + Math.min(this.elapsed * 0.11, 6);
    this.distance += speed * delta;
    this.invulnerability = Math.max(0, this.invulnerability - delta);

    const laneChange = this.input.consumeLaneDelta();
    if (laneChange !== 0) this.player.changeLane(laneChange);
    if (this.input.consumeJump() && this.player.jump()) this.audio.jump();
    if (this.input.consumeDash() && this.player.dash()) this.audio.dash();

    this.player.update(delta, this.elapsed, speed);
    this.dashTrail.visible = this.player.isDashing && !this.reducedMotion;
    if (this.dashTrail.visible) {
      this.dashTrail.position.copy(this.player.position);
      this.dashTrail.position.z += 1.25;
      this.dashTrail.scale.setScalar(0.7 + Math.sin(this.elapsed * 36) * 0.12);
    }

    this.spawnTimer -= delta;
    if (this.spawnTimer <= 0) {
      this.spawnHazard();
      this.spawnTimer = Math.max(0.94, 1.72 - this.elapsed * 0.009) + this.rng() * 0.28;
    }
    this.shardTimer -= delta;
    if (this.shardTimer <= 0) {
      this.spawnShard();
      this.shardTimer = 2.15 + this.rng() * 0.82;
    }

    this.updateHazards(delta, speed);
    this.updateShards(delta, speed);

    if (this.elapsed >= RUN_DURATION) this.endRun('won');
  }

  private updateHazards(delta: number, speed: number): void {
    for (let i = this.hazards.length - 1; i >= 0; i -= 1) {
      const hazard = this.hazards[i];
      hazard.group.position.z += speed * delta;
      hazard.phase += delta;
      if (hazard.kind === 'drone') {
        hazard.group.rotation.y += delta * 1.5;
        hazard.group.position.y = 1.25 + Math.sin(hazard.phase * 3.2) * 0.12;
      }

      if (
        !hazard.resolved &&
        Math.abs(hazard.group.position.z - this.player.position.z) < 0.72 &&
        Math.abs(LANE_X[hazard.lane] - this.player.position.x) < 1.12
      ) {
        hazard.resolved = true;
        const clearedByJump = hazard.kind === 'barrier' && this.player.isAirborne;
        if (!clearedByJump && !this.player.isDashing && this.invulnerability <= 0) this.takeHit();
      }

      if (hazard.group.position.z > 14) {
        this.disposeOwnedGroup(hazard.group, hazard.geometries, hazard.materials);
        this.hazards.splice(i, 1);
      }
    }
  }

  private updateShards(delta: number, speed: number): void {
    for (let i = this.shards.length - 1; i >= 0; i -= 1) {
      const shard = this.shards[i];
      shard.group.position.z += speed * delta;
      shard.phase += delta;
      shard.group.rotation.y += delta * 1.8;
      shard.group.position.y = 1.05 + Math.sin(shard.phase * 3.6) * 0.16;
      if (
        Math.abs(shard.group.position.z - this.player.position.z) < 0.95 &&
        Math.abs(LANE_X[shard.lane] - this.player.position.x) < 1.15
      ) {
        this.shardCount += 1;
        this.audio.pickup();
        this.spawnBurst(shard.group.position, '#f7bd70');
        this.disposeOwnedGroup(shard.group, shard.geometries, shard.materials);
        this.shards.splice(i, 1);
      } else if (shard.group.position.z > 14) {
        this.disposeOwnedGroup(shard.group, shard.geometries, shard.materials);
        this.shards.splice(i, 1);
      }
    }
  }

  private updateWorld(delta: number, elapsed: number): void {
    const speed = this.state === 'playing' ? this.tuning.speed + Math.min(this.elapsed * 0.11, 6) : 0;
    for (const layer of this.movingInstances) {
      let dirty = false;
      for (let i = 0; i < layer.z.length; i += 1) {
        if (speed > 0) {
          layer.z[i] += speed * delta * layer.speedFactor;
          if (layer.z[i] > 16) layer.z[i] -= layer.length;
          dirty = true;
        }
        this.frameDummy.position.set(layer.x[i], 0, layer.z[i]);
        this.frameDummy.scale.copy(layer.scale[i]);
        if (layer.mesh.userData.kind === 'marker') this.frameDummy.position.y = 0.035;
        else this.frameDummy.position.y = layer.scale[i].y * 0.48;
        this.frameDummy.rotation.set(0, layer.mesh.userData.kind === 'spire' ? (i % 3) * 0.17 : 0, 0);
        this.frameDummy.updateMatrix();
        layer.mesh.setMatrixAt(i, this.frameDummy.matrix);
      }
      if (dirty || layer.z.length > 0) layer.mesh.instanceMatrix.needsUpdate = true;
    }

    if (delta > 0) {
      this.player.group.visible = !(this.invulnerability > 0 && Math.floor(elapsed * 18) % 2 === 0);
      this.player.group.rotation.y = Math.sin(elapsed * 1.2) * 0.025;
    }
    this.hitTrauma = Math.max(0, this.hitTrauma - delta * 2.2);
    if (this.hitTrauma > 0) {
      const shake = this.hitTrauma * this.hitTrauma * 0.2;
      this.camera.position.x = Math.sin(elapsed * 41) * shake;
    } else {
      this.camera.position.x = 0;
    }
  }

  private updateEffects(delta: number): void {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.life -= delta;
      effect.group.scale.setScalar(1 + (0.9 - Math.max(effect.life, 0)) * 1.7);
      for (const child of effect.group.children) {
        const material = (child as THREE.Mesh).material;
        if (material instanceof THREE.MeshBasicMaterial) {
          material.opacity = Math.max(0, effect.life / 0.9) * 0.9;
        }
      }
      if (effect.life <= 0) {
        this.scene.remove(effect.group);
        effect.material.dispose();
        effect.geometry.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  private takeHit(): void {
    this.health -= 1;
    this.invulnerability = 1.05;
    this.hitTrauma = 0.85;
    this.audio.hit();
    this.hud.setHitFeedback();
    this.spawnBurst(this.player.position, '#ff776f');
    if (this.health <= 0) this.endRun('failed');
  }

  private spawnHazard(forced?: { lane: number; kind: HazardKind; z: number }): void {
    const lane = forced?.lane ?? this.randomLane();
    const roll = this.rng();
    const kind: HazardKind = forced?.kind ?? (roll < 0.44 ? 'barrier' : roll < 0.76 ? 'gate' : 'drone');
    const group = new THREE.Group();
    group.position.set(LANE_X[lane], 0, forced?.z ?? SPAWN_Z);
    const hazard: Hazard = {
      group,
      lane,
      kind,
      resolved: false,
      phase: this.rng() * Math.PI * 2,
      geometries: [],
      materials: [],
    };
    this.buildHazard(group, kind, hazard);
    this.scene.add(group);
    this.hazards.push(hazard);
  }

  private buildHazard(group: THREE.Group, kind: HazardKind, hazard: Hazard): void {
    const geometry = <T extends THREE.BufferGeometry>(value: T): T => {
      hazard.geometries.push(value);
      return value;
    };
    const material = <T extends THREE.Material>(value: T): T => {
      hazard.materials.push(value);
      return value;
    };
    const danger = material(new THREE.MeshStandardMaterial({
      color: '#ff795f',
      metalness: 0.46,
      roughness: 0.3,
      emissive: '#a32425',
      emissiveIntensity: 1.3,
    }));
    const trim = material(new THREE.MeshBasicMaterial({ color: '#ffc16e' }));

    if (kind === 'barrier') {
      const beam = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.16, 0.2, 2.25, 10)), danger);
      beam.rotation.z = Math.PI / 2;
      beam.position.y = 0.62;
      group.add(beam);
      for (const x of [-0.88, 0.88]) {
        const foot = new THREE.Mesh(geometry(new THREE.ConeGeometry(0.22, 0.55, 5)), trim);
        foot.position.set(x, 0.28, 0);
        group.add(foot);
      }
      const beacon = new THREE.Mesh(geometry(new THREE.TorusGeometry(0.86, 0.035, 6, 24)), trim);
      beacon.position.y = 0.68;
      group.add(beacon);
    } else if (kind === 'gate') {
      const arch = new THREE.Mesh(geometry(new THREE.TorusGeometry(1.05, 0.095, 8, 30)), danger);
      arch.position.y = 1.15;
      group.add(arch);
      const core = new THREE.Mesh(geometry(new THREE.TorusGeometry(0.68, 0.025, 5, 24)), trim);
      core.position.y = 1.15;
      group.add(core);
      for (const x of [-1.03, 1.03]) {
        const post = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.1, 0.16, 1.18, 8)), danger);
        post.position.set(x, 0.58, 0);
        group.add(post);
      }
    } else {
      const body = new THREE.Mesh(geometry(new THREE.IcosahedronGeometry(0.67, 1)), danger);
      body.position.y = 1.3;
      group.add(body);
      const ring = new THREE.Mesh(geometry(new THREE.TorusGeometry(0.88, 0.055, 6, 24)), trim);
      ring.position.y = 1.3;
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
      for (let i = 0; i < 4; i += 1) {
        const spike = new THREE.Mesh(geometry(new THREE.ConeGeometry(0.12, 0.38, 5)), trim);
        const angle = (i / 4) * Math.PI * 2;
        spike.position.set(Math.cos(angle) * 0.83, 1.3, Math.sin(angle) * 0.83);
        spike.rotation.z = Math.cos(angle) * Math.PI / 2;
        group.add(spike);
      }
    }
  }

  private spawnShard(forced?: { lane: number; z: number }): void {
    const lane = forced?.lane ?? this.randomLane();
    const group = new THREE.Group();
    group.position.set(LANE_X[lane], 1.05, forced?.z ?? SPAWN_Z - 1.2);
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const crystalMaterial = new THREE.MeshStandardMaterial({
      color: '#f7c476',
      metalness: 0.35,
      roughness: 0.24,
      emissive: '#8a4c18',
      emissiveIntensity: 1.1,
    });
    materials.push(crystalMaterial);
    const crystalGeometry = new THREE.OctahedronGeometry(0.3, 0);
    geometries.push(crystalGeometry);
    const crystal = new THREE.Mesh(crystalGeometry, crystalMaterial);
    group.add(crystal);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.035, 8, 28),
      new THREE.MeshBasicMaterial({ color: '#ffe1a0' }),
    );
    geometries.push(ring.geometry);
    materials.push(ring.material as THREE.Material);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    this.scene.add(group);
    this.shards.push({ group, lane, phase: this.rng() * Math.PI * 2, geometries, materials });
  }

  private spawnBurst(position: THREE.Vector3, color: string): void {
    if (this.effects.length >= 5) {
      this.scene.remove(this.effects[0].group);
      this.effects[0].material.dispose();
      this.effects[0].geometry.dispose();
      this.effects.shift();
    }
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const group = new THREE.Group();
    group.position.copy(position);
    const geometry = new THREE.TorusGeometry(0.48, 0.025, 5, 28);
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    this.scene.add(group);
    this.effects.push({ group, life: 0.9, material, geometry });
  }

  private createWorld(): void {
    this.scene.background = new THREE.Color('#08131d');
    this.scene.fog = new THREE.FogExp2('#08131d', 0.013);
    this.camera.position.set(0, 13.2, 23.5);
    this.camera.lookAt(0, 0.4, -15);

    this.scene.add(new THREE.HemisphereLight('#a6d9e8', '#101923', 1.35));
    const key = new THREE.DirectionalLight('#d8efff', 2.25);
    key.position.set(-7, 16, 5);
    this.scene.add(key);
    const cyanFill = new THREE.PointLight('#4fe5d0', 26, 34, 2);
    cyanFill.position.set(0, 5, -12);
    this.scene.add(cyanFill);

    this.createRoad();
    this.createLaneMarkers();
    this.createSkyline();
    this.createStarfield();
    this.createDistantArches();
  }

  private createRoad(): void {
    const roadTexture = this.createRoadTexture();
    const road = new THREE.Mesh(
      this.geometry(new THREE.PlaneGeometry(11.2, ROAD_LENGTH)),
      this.material(new THREE.MeshStandardMaterial({
        color: '#a6b0b3',
        map: roadTexture,
        roughness: 0.79,
        metalness: 0.2,
      })),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, -0.035, -18);
    this.scene.add(road);

    const vergeMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#111f28',
      roughness: 0.94,
      metalness: 0.05,
    }));
    const vergeGeometry = this.geometry(new THREE.PlaneGeometry(18, ROAD_LENGTH));
    for (const side of [-1, 1]) {
      const verge = new THREE.Mesh(vergeGeometry, vergeMaterial);
      verge.rotation.x = -Math.PI / 2;
      verge.position.set(side * 14.6, -0.06, -18);
      this.scene.add(verge);

      const rail = new THREE.Mesh(
        this.geometry(new THREE.CylinderGeometry(0.07, 0.07, ROAD_LENGTH, 8)),
        this.material(new THREE.MeshStandardMaterial({
          color: '#51dbc8',
          emissive: '#147669',
          emissiveIntensity: 1.3,
          metalness: 0.6,
          roughness: 0.24,
        })),
      );
      rail.rotation.x = Math.PI / 2;
      rail.position.set(side * 5.53, 0.13, -18);
      this.scene.add(rail);
      const outerRail = new THREE.Mesh(
        this.geometry(new THREE.CylinderGeometry(0.045, 0.045, ROAD_LENGTH, 8)),
        this.material(new THREE.MeshBasicMaterial({ color: '#f3a965' })),
      );
      outerRail.rotation.x = Math.PI / 2;
      outerRail.position.set(side * 5.73, 0.11, -18);
      this.scene.add(outerRail);
    }
  }

  private createLaneMarkers(): void {
    const markersPerLine = 18;
    const count = markersPerLine * 2;
    const mesh = new THREE.InstancedMesh(
      this.geometry(new THREE.BoxGeometry(0.045, 0.018, 2.2)),
      this.material(new THREE.MeshBasicMaterial({ color: '#40aaac', transparent: true, opacity: 0.6 })),
      count,
    );
    mesh.userData.kind = 'marker';
    const z: number[] = [];
    const x: number[] = [];
    const scale: THREE.Vector3[] = [];
    for (let line = 0; line < 2; line += 1) {
      for (let i = 0; i < markersPerLine; i += 1) {
        z.push(-54 + i * 6.1);
        x.push(line === 0 ? -1.53 : 1.53);
        scale.push(new THREE.Vector3(1, 1, 1));
      }
    }
    this.movingInstances.push({ mesh, z, x, scale, length: ROAD_LENGTH, speedFactor: 1 });
    this.scene.add(mesh);
  }

  private createSkyline(): void {
    const count = 42;
    const mesh = new THREE.InstancedMesh(
      this.geometry(new THREE.IcosahedronGeometry(1, 1)),
      this.material(new THREE.MeshStandardMaterial({
        color: '#142b36',
        metalness: 0.45,
        roughness: 0.58,
        emissive: '#071a22',
        emissiveIntensity: 0.6,
      })),
      count,
    );
    mesh.userData.kind = 'spire';
    const z: number[] = [];
    const x: number[] = [];
    const scales: THREE.Vector3[] = [];
    for (let i = 0; i < count; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      x.push(side * (8.5 + this.rng() * 12));
      z.push(-62 + this.rng() * 95);
      scales.push(new THREE.Vector3(
        0.75 + this.rng() * 1.35,
        1.8 + this.rng() * 6.5,
        0.7 + this.rng() * 1.3,
      ));
    }
    this.movingInstances.push({ mesh, z, x, scale: scales, length: ROAD_LENGTH, speedFactor: 0.58 });
    this.scene.add(mesh);

    const lights = new THREE.InstancedMesh(
      this.geometry(new THREE.SphereGeometry(0.12, 8, 6)),
      this.material(new THREE.MeshBasicMaterial({ color: '#eda875' })),
      24,
    );
    for (let i = 0; i < 24; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      this.frameDummy.position.set(side * (7.2 + this.rng() * 0.4), 1.1 + this.rng() * 3.2, -60 + this.rng() * 90);
      this.frameDummy.scale.setScalar(0.7 + this.rng() * 1.4);
      this.frameDummy.updateMatrix();
      lights.setMatrixAt(i, this.frameDummy.matrix);
    }
    this.scene.add(lights);
  }

  private createStarfield(): void {
    const points = new Float32Array(540 * 3);
    for (let i = 0; i < 540; i += 1) {
      points[i * 3] = (this.rng() - 0.5) * 130;
      points[i * 3 + 1] = 8 + this.rng() * 50;
      points[i * 3 + 2] = -70 + this.rng() * 120;
    }
    const geometry = this.geometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const stars = new THREE.Points(
      geometry,
      this.material(new THREE.PointsMaterial({
        color: '#a8d7dc',
        size: 0.11,
        transparent: true,
        opacity: 0.66,
        sizeAttenuation: true,
      })),
    );
    this.scene.add(stars);
  }

  private createDistantArches(): void {
    const archMaterial = this.material(new THREE.MeshBasicMaterial({
      color: '#287c83',
      transparent: true,
      opacity: 0.26,
    }));
    for (const z of [-35, -72]) {
      const arch = new THREE.Mesh(this.geometry(new THREE.TorusGeometry(10.5, 0.075, 6, 60)), archMaterial);
      arch.rotation.x = Math.PI / 2;
      arch.position.set(0, 4.8, z);
      this.scene.add(arch);
    }
  }

  private createRoadTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create procedural road texture.');
    context.fillStyle = '#18232a';
    context.fillRect(0, 0, size, size);
    for (let i = 0; i < 540; i += 1) {
      const value = 24 + Math.floor(this.rng() * 22);
      context.fillStyle = `rgba(${value},${value + 8},${value + 12},${0.12 + this.rng() * 0.24})`;
      const width = 1 + this.rng() * 5;
      const height = 1 + this.rng() * 5;
      context.fillRect(this.rng() * size, this.rng() * size, width, height);
    }
    context.strokeStyle = 'rgba(122, 191, 191, 0.08)';
    context.lineWidth = 1;
    for (let i = 0; i < size; i += 32) {
      context.beginPath();
      context.moveTo(0, i);
      context.lineTo(size, i);
      context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 18);
    this.textures.add(texture);
    return texture;
  }

  private createWingGeometry(): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-1.45, 0.52);
    shape.lineTo(-0.49, -0.22);
    shape.lineTo(-0.18, -0.46);
    shape.lineTo(0.18, -0.46);
    shape.lineTo(0.49, -0.22);
    shape.lineTo(1.45, 0.52);
    shape.lineTo(1.12, 0.3);
    shape.lineTo(0.58, 0.12);
    shape.lineTo(-0.58, 0.12);
    shape.lineTo(-1.12, 0.3);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  private resetRun(): void {
    this.clearRunObjects();
    this.player.reset();
    this.state = 'playing';
    this.elapsed = 0;
    this.distance = 0;
    this.shardCount = 0;
    this.health = 3;
    this.spawnTimer = 1.55;
    this.shardTimer = 1.2;
    this.invulnerability = 0;
    this.hitTrauma = 0;
    this.player.group.visible = true;
    this.hud.setState('playing');
    this.updateHud();
  }

  private clearRunObjects(): void {
    for (const hazard of this.hazards) {
      this.disposeOwnedGroup(hazard.group, hazard.geometries, hazard.materials);
    }
    for (const shard of this.shards) {
      this.disposeOwnedGroup(shard.group, shard.geometries, shard.materials);
    }
    for (const effect of this.effects) {
      this.scene.remove(effect.group);
      effect.material.dispose();
      effect.geometry.dispose();
    }
    this.hazards.length = 0;
    this.shards.length = 0;
    this.effects.length = 0;
  }

  private startRun(): void {
    if (this.state === 'paused') {
      this.state = 'playing';
      this.hud.setState('playing');
      return;
    }
    this.resetRun();
    void this.audio.unlock();
  }

  private togglePause(): void {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.hud.setState('paused');
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.hud.setState('playing');
    }
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
    this.hud.setMuted(this.muted);
  }

  private endRun(state: 'won' | 'failed'): void {
    this.state = state;
    this.dashTrail.visible = false;
    this.hud.setState(state);
  }

  private updateHud(): void {
    const dashReady = 1 - this.player.dashCooldown / 3.2;
    this.hud.update(this.distance, this.shardCount, this.health, dashReady, RUN_DURATION - this.elapsed);
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.shardCount,
      targetScore: RUN_DURATION,
      complete: this.state === 'won',
      state: this.state,
      distance: this.distance,
      health: this.health,
      player: {
        position: {
          x: this.player.position.x,
          y: this.player.position.y,
          z: this.player.position.z,
        },
        speed: this.state === 'playing' ? this.tuning.speed + Math.min(this.elapsed * 0.11, 6) : 0,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
    };
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        // Restarting the run after reseeding keeps scripted captures reproducible.
        this.rng = createSeededRandom(value);
      },
      setState: (name: string) => {
        const states: Record<string, RunState> = {
          'active-play': 'playing',
          pause: 'paused',
          fail: 'failed',
          win: 'won',
          title: 'title',
        };
        const nextState = states[name];
        if (!nextState) throw new Error(`Unknown test state: ${name}`);
        if (nextState === 'title') {
          this.clearRunObjects();
          this.player.reset();
          this.elapsed = 0;
          this.distance = 0;
          this.shardCount = 0;
          this.health = 3;
        } else {
          this.resetRun();
        }
        this.state = nextState;
        if (name === 'active-play') {
          this.spawnHazard({ lane: 0, kind: 'gate', z: -13.5 });
          this.spawnShard({ lane: 2, z: -14 });
        }
        this.hud.setState(this.state);
        this.render();
        this.publishDiagnostics();
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        if (enabled) this.player.group.rotation.set(0, 0, 0);
        this.render();
        this.publishDiagnostics();
      },
      hideDebugUi: (hidden: boolean) => {
        this.debugTools.setHidden(hidden);
      },
    };
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private randomLane(): number {
    return Math.floor(this.rng() * LANE_X.length);
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.add(material);
    return material;
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing game element: ${selector}`);
    return element;
  }

}
