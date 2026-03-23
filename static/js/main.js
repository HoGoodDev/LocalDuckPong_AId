import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const socket = io();

const canvas = document.getElementById("gameCanvas");
const p1Reader = document.getElementById("p1Reader");
const p2Reader = document.getElementById("p2Reader");
const scoreLine = document.getElementById("scoreLine");
const duckNames = document.getElementById("duckNames");
const messageBox = document.getElementById("messageBox");
const p1StaminaBar = document.getElementById("p1StaminaBar");
const p2StaminaBar = document.getElementById("p2StaminaBar");
const p1StaminaText = document.getElementById("p1StaminaText");
const p2StaminaText = document.getElementById("p2StaminaText");
const resetBtn = document.getElementById("resetBtn");
const winOverlay = document.getElementById("winOverlay");
const winTitle = document.getElementById("winTitle");
const winSubtitle = document.getElementById("winSubtitle");
const playAgainBtn = document.getElementById("playAgainBtn");
const p1Dot = document.getElementById("p1Dot");
const p2Dot = document.getElementById("p2Dot");

const COURT = {
  width: 20,
  height: 8,
  depth: 40,
  p1z: -18,
  p2z: 18,
};

function normalizeColor(name) {
  const map = {
    yellow: "#f3d33b",
    orange: "#f28c28",
    blue: "#4080ff",
    green: "#44aa55",
    red: "#dd4444",
    white: "#f5f5f5",
    black: "#111111",
    lightblue: "#8fd3ff",
    purple: "#8b5cf6",
    pink: "#ff7ac8",
    brown: "#8b5a2b",
  };
  return map[String(name || "").toLowerCase()] || name || "yellow";
}

class SplitScene {
  constructor(canvasEl, modelBaseUrl = "/static/models/") {
    this.canvas = canvasEl;
    this.modelBaseUrl = modelBaseUrl;
    this.currentState = null;

    // this.scene = new THREE.Scene();
    // this.scene.background = new THREE.Color(0x101418);
    this.scene = new THREE.Scene();

    // Gradient background (correct way)
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 256;

    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);

    gradient.addColorStop(0, "#0e0f14");
    gradient.addColorStop(1, "#1c1f2b");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    this.scene.background = texture;

    this.scene.fog = new THREE.Fog(0x0e0f14, 50, 100);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });

    // Reduce GPU load a bit on higher DPI displays
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    this.cameraP1 = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    this.cameraP2 = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);

    this.players = {
      p1: {
        group: new THREE.Group(),
        duck: null,
        duckRoot: null,
        shield: null,
        loadingDuckId: null,
      },
      p2: {
        group: new THREE.Group(),
        duck: null,
        duckRoot: null,
        shield: null,
        loadingDuckId: null,
      },
    };

    this.gltfLoader = new GLTFLoader();
    this.baseDuckObject = null;
    this.baseShieldRadius = 1.5;
    this.clock = new THREE.Clock();
    this._cameraTarget = new THREE.Vector3();
    this.activeEmojis = [];
    this.elapsed = 0;

    this.ball = this.createBall();
    this.scene.add(this.ball);

    // Ball point light — lights up the court around the ball
    this.ballLight = new THREE.PointLight(0xffffff, 4.0, 14);
    this.scene.add(this.ballLight);

    // Ball trail orbs
    this.trailPositions = [];
    this.trail = Array.from({ length: 10 }, (_, i) => {
      const frac = (10 - i) / 10;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.42 * frac * 0.55, 7, 7),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xffffff,
          emissiveIntensity: 0.8,
          transparent: true,
          opacity: 0,
        }),
      );
      this.scene.add(mesh);
      return mesh;
    });

    // Target values for interpolation
    this.netTargets = {
      p1: { x: 0, z: COURT.p1z },
      p2: { x: 0, z: COURT.p2z },
      ball: { x: 0, y: 2, z: 0 },
    };

    this.createLights();
    this.createStars();
    this.createShootingStars();
    this.createCourt();

    this.scene.add(this.players.p1.group);
    this.scene.add(this.players.p2.group);

    this.players.p1.group.position.set(0, 0.25, COURT.p1z);
    this.players.p2.group.position.set(0, 0.25, COURT.p2z);
    this.players.p1.group.rotation.y = 0;
    this.players.p2.group.rotation.y = Math.PI;

    this.players.p1.shield = this.createShield("p1");
    this.players.p2.shield = this.createShield("p2");
    this.players.p1.group.add(this.players.p1.shield);
    this.players.p2.group.add(this.players.p2.shield);

    this.players.p1.group.visible = false;
    this.players.p2.group.visible = false;

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.renderLoop();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.setSize(rect.width, rect.height, false);
  }

  createStars() {
    // Draw a soft round dot on a canvas so points don't render as squares
    const starCanvas = document.createElement("canvas");
    starCanvas.width = 32;
    starCanvas.height = 32;
    const ctx = starCanvas.getContext("2d");
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0,   "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
    grad.addColorStop(1,   "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const count = 400;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 300;
      pos[i * 3 + 1] = Math.random() * 80 + 15;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 300;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      alphaMap: new THREE.CanvasTexture(starCanvas),
      color: 0xffffff,
      size: 0.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  createShootingStars() {
    const COLORS = [0xffffff];
    this.shootingStars = Array.from({ length: 7 }, () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(6), 3),
      );
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0,
          fog: false,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.scene.add(line);

      return {
        line,
        attr: geo.attributes.position,
        active: false,
        timer: Math.random() * 6, // stagger start times
        waitTime: 0,
        progress: 0,
        duration: 0,
        ox: 0, oy: 0, oz: 0,   // origin
        dx: 0, dy: 0, dz: 0,   // direction (normalised)
        speed: 0,
        trailLen: 0,
      };
    });
  }

  _resetShootingStar(s) {
    s.active = true;
    s.progress = 0;
    // spawn high up, spread wide
    s.ox = (Math.random() - 0.5) * 220;
    s.oy = 35 + Math.random() * 40;
    s.oz = (Math.random() - 0.5) * 160;
    // shoot diagonally downward
    const angle = Math.PI * (0.18 + Math.random() * 0.14); // ~10-18° below horizontal
    const horiz = Math.cos(angle);
    s.dx = (Math.random() < 0.5 ? 1 : -1) * horiz * (0.6 + Math.random() * 0.4);
    s.dy = -Math.sin(angle);
    s.dz = (Math.random() - 0.5) * 0.4;
    // normalise
    const len = Math.sqrt(s.dx * s.dx + s.dy * s.dy + s.dz * s.dz);
    s.dx /= len; s.dy /= len; s.dz /= len;
    s.speed     = 10 + Math.random() * 8;
    s.trailLen  = 5  + Math.random() * 6;
    s.duration  = (18 + Math.random() * 12) / s.speed;
    s.timer     = s.duration;
  }

  createLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));

    const topLight = new THREE.DirectionalLight(0xffffff, 1.4);
    topLight.position.set(5, 20, 5);
    this.scene.add(topLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-8, 8, -8);
    this.scene.add(fillLight);

  }

  createCourt() {
    // Floor with subtle grid texture
    const floorCanvas = document.createElement("canvas");
    floorCanvas.width = 512;
    floorCanvas.height = 1024;
    const fctx = floorCanvas.getContext("2d");
    fctx.fillStyle = "#1e2340";
    fctx.fillRect(0, 0, 512, 1024);
    fctx.strokeStyle = "rgba(124,106,247,0.3)";
    fctx.lineWidth = 1.5;
    for (let x = 0; x <= 512; x += 64) {
      fctx.beginPath();
      fctx.moveTo(x, 0);
      fctx.lineTo(x, 1024);
      fctx.stroke();
    }
    for (let y = 0; y <= 1024; y += 64) {
      fctx.beginPath();
      fctx.moveTo(0, y);
      fctx.lineTo(512, y);
      fctx.stroke();
    }
    const floorTex = new THREE.CanvasTexture(floorCanvas);
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(COURT.width, 0.5, COURT.depth),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }),
    );
    floor.position.y = 0;
    this.scene.add(floor);

    // Center line: glowing white
    const centerLine = new THREE.Mesh(
      new THREE.BoxGeometry(COURT.width, 0.06, 0.3),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.9,
      }),
    );
    centerLine.position.set(0, 0.28, 0);
    this.scene.add(centerLine);

    // P1 service line: purple
    const p1Line = new THREE.Mesh(
      new THREE.BoxGeometry(COURT.width, 0.05, 0.2),
      new THREE.MeshStandardMaterial({
        color: 0x7c6af7,
        emissive: 0x7c6af7,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.65,
      }),
    );
    p1Line.position.set(0, 0.27, COURT.p1z + 5);
    this.scene.add(p1Line);

    // P2 service line: cyan
    const p2Line = new THREE.Mesh(
      new THREE.BoxGeometry(COURT.width, 0.05, 0.2),
      new THREE.MeshStandardMaterial({
        color: 0x4fc3f7,
        emissive: 0x4fc3f7,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.65,
      }),
    );
    p2Line.position.set(0, 0.27, COURT.p2z - 5);
    this.scene.add(p2Line);

    // Side walls: dark with subtle purple tint
    const leftWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 3, COURT.depth),
      new THREE.MeshStandardMaterial({
        color: 0x1a1d2e,
        transparent: true,
        opacity: 0.6,
        emissive: 0x7c6af7,
        emissiveIntensity: 0.04,
      }),
    );
    leftWall.position.set(-COURT.width / 2, 1.5, 0);
    this.scene.add(leftWall);

    const rightWall = leftWall.clone();
    rightWall.position.x = COURT.width / 2;
    this.scene.add(rightWall);

    // End walls: very subtle
    const end1 = new THREE.Mesh(
      new THREE.BoxGeometry(COURT.width, 3, 0.2),
      new THREE.MeshStandardMaterial({
        color: 0x22263a,
        transparent: true,
        opacity: 0.18,
      }),
    );
    end1.position.set(0, 1.5, -COURT.depth / 2);
    this.scene.add(end1);

    const end2 = end1.clone();
    end2.position.z = COURT.depth / 2;
    this.scene.add(end2);
  }

  createBall() {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.35,
        roughness: 0.15,
        metalness: 0.1,
      }),
    );
    mesh.position.set(0, 2, 0);
    return mesh;
  }

  createShield(side, radius = this.baseShieldRadius) {
    const isP1 = side === "p1";
    const color = isP1 ? 0x7c6af7 : 0x4fc3f7;
    const emissive = isP1 ? 0x7c6af7 : 0x4fc3f7;
    const shield = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.18, 48),
      new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.62,
        emissive,
        emissiveIntensity: 0,
      }),
    );
    shield.rotation.x = Math.PI / 2;
    shield.position.set(0, 1.8, 1.2);
    return shield;
  }

  setShieldRadius(side, radius) {
    const shield = this.players[side]?.shield;
    if (!shield) return;
    const scale = radius / this.baseShieldRadius;
    shield.scale.set(scale, 1, scale);
  }

  async loadBaseDuckModel() {
    if (this.baseDuckObject) return this.baseDuckObject;

    const gltf = await this.gltfLoader.loadAsync(
      `${this.modelBaseUrl}duck.1.glb`,
    );

    const obj = gltf.scene;

    const box1 = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box1.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.4 / maxDim;
    obj.scale.setScalar(scale);

    const box2 = new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3();
    box2.getCenter(center);
    obj.position.sub(center);
    obj.position.y += 1.2;

    obj.traverse((child) => {
      if (!child.isMesh) return;

      child.frustumCulled = false;

      if (Array.isArray(child.material)) {
        child.material = child.material.map((m) => m.clone());
      } else if (child.material) {
        child.material = child.material.clone();
      }
    });

    this.baseDuckObject = obj;
    return obj;
  }

  applyDuckColors(obj, duck) {
    const isDerpy = !!duck?.derpy;

    const duckColors = {
      head: duck?.body?.head ?? "yellow",
      front_left: duck?.body?.frontLeft ?? duck?.body?.front1 ?? "yellow",
      front_right: duck?.body?.frontRight ?? duck?.body?.front2 ?? "yellow",
      rear_left: duck?.body?.rearLeft ?? duck?.body?.back1 ?? "yellow",
      rear_right: duck?.body?.rearRight ?? duck?.body?.back2 ?? "yellow",
      eyes: isDerpy ? "white" : "black",
      normal_pupil: "white",
      derpy_eyes: "black",
      beak: "orange",
    };

    obj.traverse((child) => {
      if (!child.isMesh) return;

      const mat = child.material;
      const meshKey = String(child.name || "").toLowerCase();

      const setColor = (m, keyGuess) => {
        if (!m || !m.color) return;

        const key = String(keyGuess || "").toLowerCase();
        const chosen =
          duckColors[key] ??
          duckColors[String(m.name || "").toLowerCase()] ??
          "yellow";

        m.color.set(normalizeColor(chosen));
      };

      if (Array.isArray(mat)) {
        for (const m of mat) {
          setColor(m, meshKey);
        }
      } else {
        setColor(mat, meshKey);
      }
    });
  }

  async setPlayerDuck(side, duck) {
    const slot = this.players[side];

    if (!duck) {
      slot.duck = null;
      slot.loadingDuckId = null;

      if (slot.duckRoot) {
        slot.group.remove(slot.duckRoot);
        slot.duckRoot = null;
      }

      slot.group.visible = false;
      return;
    }

    const incomingId = duck._id ?? duck.id ?? duck.name ?? `${side}-duck`;

    if (slot.duck?._id === duck._id && slot.duckRoot) {
      return;
    }

    slot.loadingDuckId = incomingId;

    const base = await this.loadBaseDuckModel();
    const clone = base.clone(true);

    clone.traverse((child) => {
      if (!child.isMesh) return;

      child.frustumCulled = false;

      if (Array.isArray(child.material)) {
        child.material = child.material.map((m) => m.clone());
      } else if (child.material) {
        child.material = child.material.clone();
      }
    });

    this.applyDuckColors(clone, duck);

    // rotate first
    clone.rotation.y = 0;

    // then recenter THIS clone after rotation
    const box = new THREE.Box3().setFromObject(clone);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // move it so it sits centered on the player group
    clone.position.x -= center.x;
    clone.position.z -= center.z;

    // keep feet on court
    const size = new THREE.Vector3();
    box.getSize(size);
    clone.position.y -= box.min.y;

    // optional small scale tweak if needed
    // clone.scale.setScalar(1);

    if (slot.duckRoot) {
      slot.group.remove(slot.duckRoot);
      slot.duckRoot.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
      slot.duckRoot = null;
    }

    slot.duckRoot = clone;
    slot.group.add(clone);
  }

  syncDuckIfNeeded(side, duck) {
    const slot = this.players[side];
    const currentId = slot.duck?._id ?? null;
    const incomingId = duck?._id ?? null;

    if (!duck) {
      if (slot.duck || slot.duckRoot) {
        this.setPlayerDuck(side, null).catch((err) => console.error(err));
      }
      return;
    }

    if (currentId === incomingId && slot.duckRoot) {
      return;
    }

    if (slot.loadingDuckId === incomingId) {
      return;
    }

    this.setPlayerDuck(side, duck).catch((err) => {
      console.error(`Failed to load ${side} duck`, err);
      slot.loadingDuckId = null;
    });
  }

  updateCameraForSide(camera, side) {
    const localPlayer = this.players[side].group.position;
    const isP1 = side === "p1";

    const targetX = localPlayer.x * 0.15;
    const targetY = 4.2;
    const targetZ = isP1 ? 2 : -2;

    const cameraX = localPlayer.x * 0.2;
    const cameraY = 8.5;
    const cameraZ = isP1 ? -34 : 34;

    this._cameraTarget.set(cameraX, cameraY, cameraZ);
    camera.position.lerp(this._cameraTarget, 0.09);
    camera.lookAt(targetX, targetY, targetZ);
  }

  updateState(state) {
    this.currentState = state;

    this.syncDuckIfNeeded("p1", state.players.p1.duck);
    this.syncDuckIfNeeded("p2", state.players.p2.duck);

    this.players.p1.group.visible = !!state.players.p1.duck;
    this.players.p2.group.visible = !!state.players.p2.duck;

    this.setShieldRadius(
      "p1",
      state.players.p1.shieldRadius ?? this.baseShieldRadius,
    );
    this.setShieldRadius(
      "p2",
      state.players.p2.shieldRadius ?? this.baseShieldRadius,
    );

    // Store targets instead of snapping immediately
    this.netTargets.p1.x = state.players.p1.x;
    this.netTargets.p2.x = state.players.p2.x;

    this.netTargets.p1.z = state.players.p1.chaseTimer > 0 ? -8 : COURT.p1z;
    this.netTargets.p2.z = state.players.p2.chaseTimer > 0 ? 8 : COURT.p2z;

    this.netTargets.ball.x = state.ball.x;
    this.netTargets.ball.y = state.ball.y;
    this.netTargets.ball.z = state.ball.z;
  }

  createEmojiSprite(emoji) {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    ctx.font = `${Math.floor(size * 0.72)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, size / 2, size / 2);
    const texture = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(3, 3, 1);
    return sprite;
  }

  showEmoji(side, emoji) {
    const group = this.players[side].group;
    if (!group.visible) return; // don't show if duck not on court
    const sprite = this.createEmojiSprite(emoji);
    sprite.position.set(0, 5, 0);
    group.add(sprite);
    this.activeEmojis.push({
      sprite,
      group,
      timer: 0,
      maxTime: 2.2,
      startY: 5,
    });
  }

  renderLoop() {
    const tick = () => {
      const delta = Math.min(this.clock.getDelta(), 0.1); // cap at 100ms to avoid jumps on tab resume
      const width = this.canvas.clientWidth;
      const height = this.canvas.clientHeight;

      // Frame-rate independent lerp factors
      const lerpX = 1 - Math.pow(0.78, delta * 60);
      const lerpZ = 1 - Math.pow(0.92, delta * 60);
      const lerpBall = 1 - Math.pow(0.72, delta * 60);

      this.renderer.setScissorTest(true);
      this.renderer.clear();

      // Interpolate movement between network updates
      this.players.p1.group.position.x = THREE.MathUtils.lerp(
        this.players.p1.group.position.x,
        this.netTargets.p1.x,
        lerpX,
      );
      this.players.p2.group.position.x = THREE.MathUtils.lerp(
        this.players.p2.group.position.x,
        this.netTargets.p2.x,
        lerpX,
      );

      this.players.p1.group.position.z = THREE.MathUtils.lerp(
        this.players.p1.group.position.z,
        this.netTargets.p1.z,
        lerpZ,
      );
      this.players.p2.group.position.z = THREE.MathUtils.lerp(
        this.players.p2.group.position.z,
        this.netTargets.p2.z,
        lerpZ,
      );

      this.ball.position.x = THREE.MathUtils.lerp(
        this.ball.position.x,
        this.netTargets.ball.x,
        lerpBall,
      );
      this.ball.position.y = THREE.MathUtils.lerp(
        this.ball.position.y,
        this.netTargets.ball.y,
        lerpBall,
      );
      this.ball.position.z = THREE.MathUtils.lerp(
        this.ball.position.z,
        this.netTargets.ball.z,
        lerpBall,
      );

      this.ball.rotation.x += 9 * delta;
      this.ball.rotation.z += 6 * delta;

      this.elapsed += delta;

      // Ball light follows the ball
      this.ballLight.position.copy(this.ball.position);

      // Ball trail — store position history, update orb positions + opacity
      this.trailPositions.unshift(this.ball.position.clone());
      if (this.trailPositions.length > 10) this.trailPositions.pop();
      this.trail.forEach((mesh, i) => {
        if (i < this.trailPositions.length) {
          mesh.position.copy(this.trailPositions[i]);
          const frac = 1 - (i + 1) / 10;
          mesh.material.opacity = 0.55 * frac;
          mesh.material.emissiveIntensity = 0.9 * frac;
        } else {
          mesh.material.opacity = 0;
        }
      });

      // Shield pulse — only glow during active play
      const activePhase = this.currentState?.phase === "playing" || this.currentState?.phase === "waiting_serve";
      const pulse = activePhase ? 0.45 + 0.35 * Math.sin(this.elapsed * 3.5) : 0;
      if (this.players.p1.shield) this.players.p1.shield.material.emissiveIntensity = pulse;
      if (this.players.p2.shield) this.players.p2.shield.material.emissiveIntensity = pulse;


      // Shooting stars
      for (const s of this.shootingStars) {
        s.timer -= delta;
        if (s.active) {
          s.progress += delta * s.speed;
          // fade: quick in, quick out
          const tLeft = s.timer / s.duration;
          const tIn   = Math.min(s.progress / (s.trailLen * 0.6), 1);
          s.line.material.opacity = tIn * Math.min(tLeft * 6, 1) * 0.92;
          // head
          const hx = s.ox + s.dx * s.progress;
          const hy = s.oy + s.dy * s.progress;
          const hz = s.oz + s.dz * s.progress;
          // tail (shorter when star just spawned)
          const tl  = Math.min(s.progress, s.trailLen);
          const arr = s.attr.array;
          arr[0] = hx - s.dx * tl;
          arr[1] = hy - s.dy * tl;
          arr[2] = hz - s.dz * tl;
          arr[3] = hx; arr[4] = hy; arr[5] = hz;
          s.attr.needsUpdate = true;
          if (s.timer <= 0) {
            s.active = false;
            s.line.material.opacity = 0;
            s.timer = 5 + Math.random() * 12; // pause before next
          }
        } else if (s.timer <= 0) {
          this._resetShootingStar(s);
        }
      }

      // Animate floating emoji reactions
      for (let i = this.activeEmojis.length - 1; i >= 0; i--) {
        const e = this.activeEmojis[i];
        e.timer += delta;
        const t = e.timer / e.maxTime;
        e.sprite.position.y = e.startY + t * 2.5;
        e.sprite.material.opacity = 1 - t * t; // ease-out fade
        if (e.timer >= e.maxTime) {
          e.group.remove(e.sprite);
          e.sprite.material.map.dispose();
          e.sprite.material.dispose();
          this.activeEmojis.splice(i, 1);
        }
      }

      this.updateCameraForSide(this.cameraP1, "p1");
      this.updateCameraForSide(this.cameraP2, "p2");

      // Left viewport - P1
      this.renderer.setViewport(0, 0, width / 2, height);
      this.renderer.setScissor(0, 0, width / 2, height);
      this.cameraP1.aspect = width / 2 / height;
      this.cameraP1.updateProjectionMatrix();
      this.renderer.render(this.scene, this.cameraP1);

      // Right viewport - P2
      this.renderer.setViewport(width / 2, 0, width / 2, height);
      this.renderer.setScissor(width / 2, 0, width / 2, height);
      this.cameraP2.aspect = width / 2 / height;
      this.cameraP2.updateProjectionMatrix();
      this.renderer.render(this.scene, this.cameraP2);

      requestAnimationFrame(tick);
    };

    tick();
  }
}

const scene = new SplitScene(canvas);
let currentState = null;
const lastScoreRef = { p1: 0, p2: 0 };

function normalizePercent(current, max) {
  if (!max) return 0;
  return Math.max(0, Math.min(100, (current / max) * 100));
}

function updateUI(state) {
  currentState = state;

  const p1Duck = state.players.p1.duck;
  const p2Duck = state.players.p2.duck;

  const p1Name = p1Duck?.name || "Waiting";
  const p2Name = p2Duck?.name || "Waiting";

  p1Reader.textContent = `P1: ${p1Duck ? p1Name : "waiting for duck"}`;
  p2Reader.textContent = `P2: ${p2Duck ? p2Name : "waiting for duck"}`;
  p1Dot.classList.toggle("active", !!p1Duck);
  p2Dot.classList.toggle("active", !!p2Duck);

  const p1Score = state.players.p1.score;
  const p2Score = state.players.p2.score;
  scoreLine.textContent = `${p1Score} - ${p2Score}`;
  if (p1Score !== lastScoreRef.p1 || p2Score !== lastScoreRef.p2) {
    lastScoreRef.p1 = p1Score;
    lastScoreRef.p2 = p2Score;
    scoreLine.classList.remove("score-pop");
    void scoreLine.offsetWidth;
    scoreLine.classList.add("score-pop");
  }

  const formatStats = (duck) => {
    if (!duck?.stats) return "";
    const s = duck.stats;
    return `S:${s.strength ?? 0}  H:${s.health ?? 0}  I:${s.intelligence ?? 0}  F:${s.focus ?? 0}  K:${s.kindness ?? 0}`;
  };

  if (p1Duck && p2Duck) {
    duckNames.innerHTML = `
            <div><strong>${p1Name}</strong></div>
            <div style="font-size:0.72rem;margin-bottom:4px">${formatStats(p1Duck)}</div>
            <div style="color:#4a4f6a;font-size:0.7rem">— vs —</div>
            <div><strong>${p2Name}</strong></div>
            <div style="font-size:0.72rem">${formatStats(p2Duck)}</div>
        `;
  } else {
    duckNames.textContent = "Waiting for ducks...";
  }
  p1StaminaText.textContent = `${Math.round(state.players.p1.stamina)} / ${Math.round(state.players.p1.staminaMax)}`;
  p2StaminaText.textContent = `${Math.round(state.players.p2.stamina)} / ${Math.round(state.players.p2.staminaMax)}`;

  p1StaminaBar.style.width = `${normalizePercent(state.players.p1.stamina, state.players.p1.staminaMax)}%`;
  p2StaminaBar.style.width = `${normalizePercent(state.players.p2.stamina, state.players.p2.staminaMax)}%`;

  messageBox.textContent = state.lastEventMessage || "";
  scene.updateState(state);

  if (state.phase === "gameover" && state.winner) {
    const winnerName =
      state.players?.[state.winner]?.duck?.name ||
      state.players?.[state.winner]?.name ||
      (state.winner === "p1" ? "Player 1" : "Player 2");

    winTitle.textContent = `${winnerName} Wins!`;
    winSubtitle.textContent = "Press reset to play again";
    winOverlay.classList.remove("hidden");
  } else {
    winOverlay.classList.add("hidden");
  }
}

socket.on("game_state", (state) => {
  updateUI(state);
});

socket.on("disconnect", () => {
  messageBox.textContent = "Disconnected — reconnecting...";
});

socket.on("connect", () => {
  if (currentState)
    messageBox.textContent = currentState.lastEventMessage || "";
});

// Send movement only when effective direction changes
const inputState = {
  p1Left: false,
  p1Right: false,
  p2Left: false,
  p2Right: false,
};

const lastSentDir = {
  p1: null,
  p2: null,
};

function getDirForSide(side) {
  if (side === "p1") {
    if (inputState.p1Left && !inputState.p1Right) return -1;
    if (inputState.p1Right && !inputState.p1Left) return 1;
    return 0;
  }

  if (inputState.p2Left && !inputState.p2Right) return -1;
  if (inputState.p2Right && !inputState.p2Left) return 1;
  return 0;
}

function sendMoveIfChanged(side) {
  if (!currentState /*|| currentState.phase !== "playing"*/) return;

  const dir = getDirForSide(side);
  if (lastSentDir[side] === dir) return;

  lastSentDir[side] = dir;

  let adjustedDir = dir;
  if (side === "p1") adjustedDir *= -1;

  socket.emit("player_input", {
    side,
    moveDir: adjustedDir,
  });
}

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();

  // P1 (A / D)
  if (key === "a") {
    inputState.p1Left = true;
    sendMoveIfChanged("p1");
    return;
  }

  if (key === "d") {
    inputState.p1Right = true;
    sendMoveIfChanged("p1");
    return;
  }

  // P2 (Arrow Keys)
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    inputState.p2Left = true;
    sendMoveIfChanged("p2");
    return;
  }

  if (e.key === "ArrowRight") {
    e.preventDefault();
    inputState.p2Right = true;
    sendMoveIfChanged("p2");
    return;
  }

  // Serve
  if (e.code === "Space") {
    e.preventDefault();
    socket.emit("serve", { side: "p1" });
    return;
  }

  if (e.key === "Enter") {
    e.preventDefault();
    socket.emit("serve", { side: "p2" });
  }
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();

  // P1 stop
  if (key === "a") {
    inputState.p1Left = false;
    sendMoveIfChanged("p1");
    return;
  }

  if (key === "d") {
    inputState.p1Right = false;
    sendMoveIfChanged("p1");
    return;
  }

  // P2 stop
  if (e.key === "ArrowLeft") {
    inputState.p2Left = false;
    sendMoveIfChanged("p2");
    return;
  }

  if (e.key === "ArrowRight") {
    inputState.p2Right = false;
    sendMoveIfChanged("p2");
  }
});

window.addEventListener("blur", () => {
  inputState.p1Left = false;
  inputState.p1Right = false;
  inputState.p2Left = false;
  inputState.p2Right = false;
  sendMoveIfChanged("p1");
  sendMoveIfChanged("p2");
});

// Emoji reactions
const EMOJIS = ["😂", "😤", "🎉", "😢", "👍"];
const P1_EMOJI_KEYS = { q: 0, w: 1, e: 2, r: 3, t: 4 };
const P2_EMOJI_CODES = {
  Numpad1: 0,
  Numpad2: 1,
  Numpad3: 2,
  Numpad4: 3,
  Numpad5: 4,
};
const emojiCooldown = { p1: 0, p2: 0 };
const EMOJI_COOLDOWN_MS = 600;

window.addEventListener("keydown", (e) => {
  if (e.repeat) return; // ignore held keys
  const now = Date.now();
  const key = e.key.toLowerCase();
  if (key in P1_EMOJI_KEYS && now > emojiCooldown.p1) {
    emojiCooldown.p1 = now + EMOJI_COOLDOWN_MS;
    scene.showEmoji("p1", EMOJIS[P1_EMOJI_KEYS[key]]);
    return;
  }
  if (e.code in P2_EMOJI_CODES && now > emojiCooldown.p2) {
    emojiCooldown.p2 = now + EMOJI_COOLDOWN_MS;
    scene.showEmoji("p2", EMOJIS[P2_EMOJI_CODES[e.code]]);
  }
});

resetBtn.addEventListener("click", () => {
  socket.emit("reset_game");
});

playAgainBtn.addEventListener("click", () => {
  winOverlay.classList.add("hidden"); // instant feedback
  socket.emit("reset_game");
});
