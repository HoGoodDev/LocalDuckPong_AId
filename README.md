Here’s a clean, classroom-ready README you can drop into your project.

---

# Duck Pong (Local NFC Pong)

A **2-player local split-screen game** where students use **NFC card readers (“portals”)** to load their ducks and compete in a pong-style match.

- One screen (split view)
- Two players (local controls)
- NFC cards load ducks automatically
- Flask + Socket.IO backend
- Three.js frontend

---

# Features

- **Automatic duck loading** from NFC portals (no UI selection)
- **Split-screen gameplay** (each player sees their own perspective)
- **Stat-driven mechanics**:
    - Focus → shield size
    - Strength → hit power
    - Health → stamina drain
    - Intelligence → stamina pool
    - Kindness → special behavior (chase mechanic)

- **Server-authoritative game loop**
- **Real-time updates via Socket.IO**

---

# File Structure

```text
LocalDuckPong/
├── app.py                  # Flask + Socket.IO server
├── game_logic.py           # Core game simulation (ball, players, scoring)
├── reader_service.py       # NFC portal integration
├── duck_api.py             # Fetches ducks from API
├── nfc_portal.py           # NFC reader manager (your existing module)
├── requirements.txt
│
├── templates/
│   └── index.html          # Main UI
│
└── static/
    ├── style.css
    ├── js/
    │   └── main.js         # Frontend game + rendering
    └── models/
        ├── duck.obj
        ├── duck.mtl
        └── textures...
```

---

# Setup

## 1. Install dependencies

```bash
pip install -r requirements.txt
pip install pyscard
```

---

## 2. Run the app

```bash
python app.py
```

Open:

```text
http://127.0.0.1:5000
```

---

## 3. (Optional) Enable NFC simulation

If you want to test without readers:

```bash
set NFC_SIM_MODE=1
```

---

## 4. (Optional) Assign specific readers to players

If your readers are inconsistent:

```bash
set P1_READER_NAME=Your Reader Name 1
set P2_READER_NAME=Your Reader Name 2
```

---

# Controls

| Player | Move  | Serve |
| ------ | ----- | ----- |
| P1     | A / D | Space |
| P2     | ← / → | Enter |

---

# How Ducks Work

Ducks are loaded automatically from NFC cards via `nfc_portal.py`.

Each duck has stats:

```python
{
  "strength": int,
  "focus": int,
  "health": int,
  "kindness": int,
  "intelligence": int
}
```

These are converted into gameplay values:

```python
def buildDuckStats(duck):
    return {
        speed: 4 + kindness * 0.45,
        hitSpeed: 7 + strength * 0.7,
        staminaMax: intelligence * 20,
        tireRate: max(3.5, 13 - health),
        recoverRate: 5 + health * 0.6,
        shieldRadius: 0.6 + focus * 0.15,
    }
```

---

# How the System Works

## NFC Layer (`reader_service.py`)

- Uses `NfcPortalManager`
- Reads both portals continuously
- Extracts duck ID from tag
- Fetches full duck from API
- Returns:

```python
{
  "p1": { "duck": {...} },
  "p2": { "duck": {...} }
}
```

---

## Game Engine (`game_logic.py`)

Handles:

- Player movement
- Ball physics
- Collision (shield-based)
- Scoring
- Serve logic
- Special behaviors (kindness chase)

---

## Server (`app.py`)

- Runs background loop at ~30 FPS
- Reads portals
- Updates game state
- Broadcasts state via Socket.IO

```python
if changed or events or game.phase == "playing":
    socketio.emit("game_state", game.public_state())
```

---

## Frontend (`main.js`)

- Renders scene using Three.js
- Handles split-screen cameras
- Sends player input to server
- Applies duck colors from data

---

# Development Tips

- Use `NFC_SIM_MODE=1` for testing without hardware
- Add logs in:
    - `reader_service.py`
    - `game_logic.py`

- Use browser console to confirm inputs are sent

---

# Future Ideas

- 🕹️ Gamepad/controller support
- 🦆 Duck abilities (special moves)
- 🔊 Sound effects on hit/score
- 🧠 AI opponent mode
- 🏆 Tournament bracket system
- 📊 Stats tracking per duck

---
