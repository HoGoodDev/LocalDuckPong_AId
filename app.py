from flask import Flask, render_template
from flask_socketio import SocketIO
import atexit

from game_logic import GameState
from reader_service import ReaderService

app = Flask(__name__)
app.config["SECRET_KEY"] = "duck-tennis-local"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

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
    move_dir = int(data.get("moveDir", 0))

    if side not in ("p1", "p2"):
        return

    move_dir = max(-1, min(1, move_dir))
    game.set_player_input(side, move_dir)


def background_loop():
    while True:
        changed = False

        reader_state = readers.get_state()

        if game.apply_reader_state(reader_state):
            changed = True

        events = game.tick()

        # Always send updates while playing so movement is visible
        if changed or events or game.phase in ("playing", "waiting_serve"):
            socketio.emit("game_state", game.public_state())
        socketio.sleep(1 / 30)


@atexit.register
def shutdown_readers():
    readers.stop()


if __name__ == "__main__":
    socketio.start_background_task(background_loop)
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
