from flask import Flask, render_template
from flask_socketio import SocketIO
import atexit
import time

from game_logic import GameState
from reader_service import ReaderService

from nfc_portal import run_simulator_input_loop
import threading

app = Flask(__name__)
app.config["SECRET_KEY"] = "duck-tennis-local"

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")
tick_interval = 1/60
game = GameState()
readers = ReaderService()


@app.route("/")
def index():
    return render_template("index.html")


@socketio.on("connect")
def on_connect():
    socketio.emit("game_state", game.public_state())


@socketio.on("serve")
def on_serve(data):
    side = data.get("side")
    if side not in ("p1", "p2"):
        return

    changed = game.try_serve(side)
    if changed:
        socketio.emit("game_state", game.public_state())


@socketio.on("player_input")
def on_player_input(data):
    side = data.get("side")
    if side not in ("p1", "p2"):
        return

    try:
        move_dir = int(data.get("moveDir", 0))
    except Exception:
        move_dir = 0

    move_dir = max(-1, min(1, move_dir))
    game.set_player_input(side, move_dir)


@socketio.on("reset_game")
def on_reset_game():
    global game
    game = GameState()
    socketio.emit("game_state", game.public_state())


def background_loop():
    last_emit = 0.0
    emit_interval = 1 / 20   # 20 broadcasts/sec
    tick_interval = 1 / 60   # 60 sim ticks/sec

    while True:
        changed = False

        reader_state = readers.get_state()
        if game.apply_reader_state(reader_state):
            changed = True

        events = game.tick()
        now = time.time()

        should_emit = (
            changed
            or events
            or (
                game.phase in ("playing", "waiting_serve")
                and (now - last_emit) >= emit_interval
            )
        )

        if should_emit:
            socketio.emit("game_state", game.public_state())
            last_emit = now

        socketio.sleep(tick_interval)


@atexit.register
def shutdown_readers():
    readers.stop()


if __name__ == "__main__":
    socketio.start_background_task(background_loop)
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
