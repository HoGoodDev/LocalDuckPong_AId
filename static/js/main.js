import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";

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

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x101418);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);

        this.cameraP1 = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
        this.cameraP2 = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);

        this.players = {
            p1: { group: new THREE.Group(), duck: null, shield: null },
            p2: { group: new THREE.Group(), duck: null, shield: null },
        };

        this.baseDuckObject = null;
        this.baseShieldRadius = 1.5;

        this.ball = this.createBall();
        this.scene.add(this.ball);

        this.createLights();
        this.createCourt();

        this.scene.add(this.players.p1.group);
        this.scene.add(this.players.p2.group);

        this.players.p1.group.position.set(0, 0, COURT.p1z);
        this.players.p2.group.position.set(0, 0, COURT.p2z);
        this.players.p1.group.rotation.y = 0;
        this.players.p2.group.rotation.y = Math.PI;

        this.players.p1.shield = this.createShield();
        this.players.p2.shield = this.createShield();
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

    createLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));

        const light1 = new THREE.DirectionalLight(0xffffff, 1.1);
        light1.position.set(10, 15, 10);
        this.scene.add(light1);

        const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
        light2.position.set(-10, 8, -8);
        this.scene.add(light2);
    }

    createCourt() {
        const floor = new THREE.Mesh(
            new THREE.BoxGeometry(COURT.width, 0.5, COURT.depth),
            new THREE.MeshStandardMaterial({ color: 0x254a2b }),
        );
        floor.position.y = 0;
        this.scene.add(floor);

        const centerLine = new THREE.Mesh(
            new THREE.BoxGeometry(COURT.width, 0.05, 0.2),
            new THREE.MeshStandardMaterial({ color: 0xffffff }),
        );
        centerLine.position.set(0, 0.28, 0);
        this.scene.add(centerLine);

        const leftWall = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 3, COURT.depth),
            new THREE.MeshStandardMaterial({
                color: 0x333b44,
                transparent: true,
                opacity: 0.45,
            }),
        );
        leftWall.position.set(-COURT.width / 2, 1.5, 0);
        this.scene.add(leftWall);

        const rightWall = leftWall.clone();
        rightWall.position.x = COURT.width / 2;
        this.scene.add(rightWall);

        const end1 = new THREE.Mesh(
            new THREE.BoxGeometry(COURT.width, 3, 0.2),
            new THREE.MeshStandardMaterial({
                color: 0x444444,
                transparent: true,
                opacity: 0.25,
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
            new THREE.SphereGeometry(0.45, 24, 24),
            new THREE.MeshStandardMaterial({ color: 0xfff067 }),
        );
        mesh.position.set(0, 2, 0);
        return mesh;
    }

    createShield(radius = this.baseShieldRadius) {
        const shield = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, 0.15, 40),
            new THREE.MeshStandardMaterial({
                color: 0x66ccff,
                transparent: true,
                opacity: 0.35,
                emissive: 0x224455,
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

        const mtlLoader = new MTLLoader();
        mtlLoader.setPath(this.modelBaseUrl);

        const materials = await new Promise((resolve, reject) => {
            mtlLoader.load("duck.mtl", resolve, undefined, reject);
        });

        materials.preload();

        const objLoader = new OBJLoader();
        objLoader.setPath(this.modelBaseUrl);
        objLoader.setMaterials(materials);

        const obj = await new Promise((resolve, reject) => {
            objLoader.load("duck.obj", resolve, undefined, reject);
        });

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
        const isDerpy = !!duck.derpy;

        const duckColors = {
            head: duck.body?.head ?? "yellow",
            front_left: duck.body?.frontLeft ?? duck.body?.front1 ?? "yellow",
            front_right: duck.body?.frontRight ?? duck.body?.front2 ?? "yellow",
            rear_left: duck.body?.rearLeft ?? duck.body?.back1 ?? "yellow",
            rear_right: duck.body?.rearRight ?? duck.body?.back2 ?? "yellow",
            eyes: isDerpy ? "white" : "black",
            normal_pupil: "white",
            derpy_eyes: "black",
            beak: "orange",
        };

        obj.traverse((child) => {
            if (!child.isMesh) return;

            const mat = child.material;
            const meshKey = child.name;

            const setColor = (m, key) => {
                if (!m || !m.color) return;
                const chosen =
                    duckColors[key] ??
                    duckColors[String(m.name || "").toLowerCase()] ??
                    "yellow";
                m.color.set(normalizeColor(chosen));
            };

            if (Array.isArray(mat)) {
                for (const m of mat) {
                    setColor(m, m.name);
                }
            } else {
                setColor(mat, meshKey);
            }
        });
    }

    async setPlayerDuck(side, duck) {
        const base = await this.loadBaseDuckModel();
        const clone = base.clone(true);

        clone.traverse((child) => {
            if (!child.isMesh) return;
            if (Array.isArray(child.material)) {
                child.material = child.material.map((m) => m.clone());
            } else if (child.material) {
                child.material = child.material.clone();
            }
        });

        this.applyDuckColors(clone, duck);

        const slot = this.players[side];
        const shield = slot.shield;

        slot.group.clear();
        slot.group.add(clone);
        if (shield) slot.group.add(shield);

        slot.duck = duck;
        slot.group.visible = true;
    }

    updateCameraForSide(camera, side, state) {
        const localPlayer = state.players[side];
        const isP1 = side === "p1";

        const targetX = localPlayer.x * 0.15;
        const targetY = 4.2;
        const targetZ = isP1 ? 2 : -2;

        const cameraX = localPlayer.x * 0.2;
        const cameraY = 8.5;
        const cameraZ = isP1 ? -34 : 34;

        camera.position.lerp(
            new THREE.Vector3(cameraX, cameraY, cameraZ),
            0.04,
        );
        camera.lookAt(targetX, targetY, targetZ);
    }

    async updateState(state) {
        this.currentState = state;

        if (state.players.p1.duck && !this.players.p1.duck?._id) {
            await this.setPlayerDuck("p1", state.players.p1.duck);
        }
        if (state.players.p2.duck && !this.players.p2.duck?._id) {
            await this.setPlayerDuck("p2", state.players.p2.duck);
        }

        if (
            state.players.p1.duck &&
            this.players.p1.duck?._id !== state.players.p1.duck._id
        ) {
            await this.setPlayerDuck("p1", state.players.p1.duck);
        }
        if (
            state.players.p2.duck &&
            this.players.p2.duck?._id !== state.players.p2.duck._id
        ) {
            await this.setPlayerDuck("p2", state.players.p2.duck);
        }

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

        this.players.p1.group.position.x = state.players.p1.x;
        this.players.p2.group.position.x = state.players.p2.x;

        if (state.players.p1.chaseTimer > 0) {
            this.players.p1.group.position.z = THREE.MathUtils.lerp(
                this.players.p1.group.position.z,
                -8,
                0.08,
            );
        } else {
            this.players.p1.group.position.z = THREE.MathUtils.lerp(
                this.players.p1.group.position.z,
                COURT.p1z,
                0.08,
            );
        }

        if (state.players.p2.chaseTimer > 0) {
            this.players.p2.group.position.z = THREE.MathUtils.lerp(
                this.players.p2.group.position.z,
                8,
                0.08,
            );
        } else {
            this.players.p2.group.position.z = THREE.MathUtils.lerp(
                this.players.p2.group.position.z,
                COURT.p2z,
                0.08,
            );
        }

        this.ball.position.set(state.ball.x, state.ball.y, state.ball.z);

        this.updateCameraForSide(this.cameraP1, "p1", state);
        this.updateCameraForSide(this.cameraP2, "p2", state);
    }

    renderLoop() {
        const tick = () => {
            const width = this.canvas.clientWidth;
            const height = this.canvas.clientHeight;

            this.renderer.setScissorTest(true);
            this.renderer.clear();

            this.ball.rotation.x += 0.15;
            this.ball.rotation.z += 0.1;

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

function normalizePercent(current, max) {
    if (!max) return 0;
    return Math.max(0, Math.min(100, (current / max) * 100));
}

function updateUI(state) {
    currentState = state;

    const p1Name = state.players.p1.duck?.name || "Waiting";
    const p2Name = state.players.p2.duck?.name || "Waiting";

    p1Reader.textContent = `P1: ${state.players.p1.duck ? p1Name : "waiting for duck"}`;
    p2Reader.textContent = `P2: ${state.players.p2.duck ? p2Name : "waiting for duck"}`;

    scoreLine.textContent = `${state.players.p1.score} - ${state.players.p2.score}`;
    duckNames.textContent = `${p1Name} vs ${p2Name}`;

    p1StaminaText.textContent = `${Math.round(state.players.p1.stamina)} / ${Math.round(state.players.p1.staminaMax)}`;
    p2StaminaText.textContent = `${Math.round(state.players.p2.stamina)} / ${Math.round(state.players.p2.staminaMax)}`;

    p1StaminaBar.style.width = `${normalizePercent(state.players.p1.stamina, state.players.p1.staminaMax)}%`;
    p2StaminaBar.style.width = `${normalizePercent(state.players.p2.stamina, state.players.p2.staminaMax)}%`;

    messageBox.textContent = state.lastEventMessage || "";
    scene.updateState(state);
}

socket.on("game_state", (state) => {
    updateUI(state);
});

function sendMove(side, dir) {
    if (!currentState || currentState.phase !== "playing") return;

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
        sendMove("p1", -1);
        return;
    }

    if (key === "d") {
        sendMove("p1", 1);
        return;
    }

    // P2 (Arrow Keys)
    if (e.key === "ArrowLeft") {
        sendMove("p2", -1);
        return;
    }

    if (e.key === "ArrowRight") {
        sendMove("p2", 1);
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
    if (key === "a" || key === "d") {
        sendMove("p1", 0);
        return;
    }

    // P2 stop
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        sendMove("p2", 0);
    }
});
