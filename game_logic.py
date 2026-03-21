import math
import random
import time
from copy import deepcopy

COURT = {
    "width": 20,
    "height": 8,
    "depth": 40,
    "player_z1": -18,
    "player_z2": 18,
    "player_x_limit": 8.5,
}

BALL_RADIUS = 0.45
WIN_SCORE = 5
BASE_BALL_SPEED = 10


def clamp(value, min_value, max_value):
    return max(min_value, min(max_value, value))


def to_number(value, default=5.0):
    try:
        return float(value)
    except Exception:
        return float(default)


def default_stats():
    return {
        "speed": 6.0,
        "hitSpeed": BASE_BALL_SPEED,
        "staminaMax": 100.0,
        "stamina": 100.0,
        "tireRate": 8.0,
        "recoverRate": 10.0,
        "kindness": 5.0,
        "shieldRadius": 1.5,
    }


def build_duck_stats(duck):
    # Supports either duck["stats"] or top-level values if needed
    attrs = duck.get("stats", duck) if duck else {}

    focus = to_number(attrs.get("focus", 5))
    strength = to_number(attrs.get("strength", 5))
    health = to_number(attrs.get("health", 5))
    kindness = to_number(attrs.get("kindness", 5))
    intelligence = to_number(attrs.get("intelligence", 5))

    stamina_max = intelligence * 20.0

    return {
        "speed": 4.0 + kindness * 0.45,
        "hitSpeed": BASE_BALL_SPEED - 3 + (strength * 1.5),
        "staminaMax": stamina_max,
        "stamina": stamina_max,
        "tireRate": max(3.5, 13.0 - health),
        "recoverRate": 5.0 + health * 0.6,
        "kindness": kindness,
        "shieldRadius": 0.6 + focus * 0.15,
    }


def make_player(name, side, z):
    return {
        "name": name,
        "side": side,
        "duck_id": None,
        "duck": None,
        "x": 0.0,
        "z": z,
        "moveDir": 0,
        "score": 0,
        "chaseTimer": 0.0,
        "stats": default_stats(),
    }


def make_ball():
    return {
        "x": 0.0,
        "y": 2.0,
        "z": 0.0,
        "vx": random.uniform(-3, 3),
        "vy": 0.0,
        "vz": 8.0 if random.random() < 0.5 else -8.0,
        "radius": BALL_RADIUS,
        "lastHitBy": None,
    }


class GameState:
    def __init__(self):
        self.players = {
            "p1": make_player("Player 1", "p1", COURT["player_z1"]),
            "p2": make_player("Player 2", "p2", COURT["player_z2"]),
        }

        self.ball = make_ball()

        # waiting_for_ducks | waiting_serve | playing | gameover
        self.phase = "waiting_for_ducks"
        self.lastEventMessage = "Place both ducks on the portals."
        self.winner = None
        self.lastScorer = None
        self.serveWaitingFor = None
        self.serveToward = None
        self.lastTick = time.time()

    def public_state(self):
        return {
            "phase": self.phase,
            "winner": self.winner,
            "lastEventMessage": self.lastEventMessage,
            "serveWaitingFor": self.serveWaitingFor,
            "serveToward": self.serveToward,
            "players": {
                "p1": {
                    "name": self.players["p1"]["name"],
                    "duck": deepcopy(self.players["p1"]["duck"]),
                    "x": self.players["p1"]["x"],
                    "z": self.players["p1"]["z"],
                    "score": self.players["p1"]["score"],
                    "stamina": self.players["p1"]["stats"]["stamina"],
                    "staminaMax": self.players["p1"]["stats"]["staminaMax"],
                    "shieldRadius": self.players["p1"]["stats"]["shieldRadius"],
                    "chaseTimer": self.players["p1"]["chaseTimer"],
                },
                "p2": {
                    "name": self.players["p2"]["name"],
                    "duck": deepcopy(self.players["p2"]["duck"]),
                    "x": self.players["p2"]["x"],
                    "z": self.players["p2"]["z"],
                    "score": self.players["p2"]["score"],
                    "stamina": self.players["p2"]["stats"]["stamina"],
                    "staminaMax": self.players["p2"]["stats"]["staminaMax"],
                    "shieldRadius": self.players["p2"]["stats"]["shieldRadius"],
                    "chaseTimer": self.players["p2"]["chaseTimer"],
                },
            },
            "ball": {
                "x": self.ball["x"],
                "y": self.ball["y"],
                "z": self.ball["z"],
                "radius": self.ball["radius"],
                "lastHitBy": self.ball["lastHitBy"],
            },
        }

    def apply_reader_state(self, reader_state):
        changed = False

        for side in ("p1", "p2"):
            incoming_duck = reader_state[side].get("duck")
            incoming_id = reader_state[side].get("duck_id")
            current_id = self.players[side]["duck_id"]

            if str(current_id) != str(incoming_id):
                changed = True

                self.players[side]["duck_id"] = incoming_id
                self.players[side]["duck"] = incoming_duck

                if incoming_duck:
                    self.players[side]["name"] = incoming_duck.get(
                        "name",
                        "Player 1" if side == "p1" else "Player 2",
                    )
                    self.players[side]["stats"] = build_duck_stats(
                        incoming_duck)
                    self.players[side]["stats"]["stamina"] = self.players[side]["stats"]["staminaMax"]
                else:
                    self.players[side]["name"] = "Player 1" if side == "p1" else "Player 2"
                    self.players[side]["stats"] = default_stats()

        p1_present = self.players["p1"]["duck"] is not None
        p2_present = self.players["p2"]["duck"] is not None

        if self.phase == "waiting_for_ducks":
            if p1_present and p2_present:
                self.start_match()
                changed = True
            else:
                self.lastEventMessage = "Place both ducks on the portals."

        elif (not p1_present or not p2_present) and self.phase in ("waiting_serve", "playing", "gameover"):
            self.phase = "waiting_for_ducks"
            self.winner = None
            self.serveWaitingFor = None
            self.serveToward = None
            self.lastEventMessage = "A duck was removed. Place both ducks on the portals."
            self.reset_positions()
            self.reset_ball("p1")
            changed = True

        return changed

    def set_player_input(self, side, move_dir):
        self.players[side]["moveDir"] = int(move_dir)

    def start_match(self):
        self.phase = "waiting_serve"
        self.winner = None

        self.players["p1"]["score"] = 0
        self.players["p2"]["score"] = 0

        self.players["p1"]["stats"]["stamina"] = self.players["p1"]["stats"]["staminaMax"]
        self.players["p2"]["stats"]["stamina"] = self.players["p2"]["stats"]["staminaMax"]

        self.lastScorer = "p1" if random.random() < 0.5 else "p2"
        self.serveToward = self.lastScorer
        self.serveWaitingFor = "p2" if self.lastScorer == "p1" else "p1"

        self.reset_positions()
        self.reset_ball(self.serveToward)
        self.lastEventMessage = f"{self.serveWaitingFor.upper()} press serve key to begin."

    def try_serve(self, side):
        if self.phase != "waiting_serve":
            return False

        if side != self.serveWaitingFor:
            return False

        self.phase = "playing"
        self.lastEventMessage = "Play!"
        return True

    def reset_positions(self):
        self.players["p1"]["x"] = 0.0
        self.players["p2"]["x"] = 0.0
        self.players["p1"]["z"] = COURT["player_z1"]
        self.players["p2"]["z"] = COURT["player_z2"]
        self.players["p1"]["moveDir"] = 0
        self.players["p2"]["moveDir"] = 0
        self.players["p1"]["chaseTimer"] = 0.0
        self.players["p2"]["chaseTimer"] = 0.0

    def reset_ball(self, toward_side="p1"):
        self.ball["x"] = 0.0
        self.ball["y"] = 2.0
        self.ball["z"] = 0.0
        self.ball["vx"] = random.uniform(-3, 3)
        self.ball["vy"] = 0.0
        self.ball["vz"] = - \
            BASE_BALL_SPEED if toward_side == "p1" else BASE_BALL_SPEED
        self.ball["lastHitBy"] = None

    def get_effective_speed(self, player):
        ratio = player["stats"]["stamina"] / \
            max(1.0, player["stats"]["staminaMax"])

        if ratio > 0.5:
            return player["stats"]["speed"]
        if ratio > 0.2:
            return player["stats"]["speed"] * 0.8
        return player["stats"]["speed"] * 0.6

    def update_player(self, player, dt):
        if player["chaseTimer"] > 0:
            player["chaseTimer"] = max(0.0, player["chaseTimer"] - dt)

        # Let chase visually move the player forward a little
        if player["chaseTimer"] > 0:
            if player["side"] == "p1":
                player["z"] = -8.0
            else:
                player["z"] = 8.0
        else:
            if player["side"] == "p1":
                player["z"] = COURT["player_z1"]
            else:
                player["z"] = COURT["player_z2"]

        speed = self.get_effective_speed(player)
        player["x"] += player["moveDir"] * speed * dt
        player["x"] = clamp(
            player["x"], -COURT["player_x_limit"], COURT["player_x_limit"])

        if player["moveDir"] != 0:
            player["stats"]["stamina"] = max(
                0.0,
                player["stats"]["stamina"] - player["stats"]["tireRate"] * dt,
            )
        else:
            player["stats"]["stamina"] = min(
                player["stats"]["staminaMax"],
                player["stats"]["stamina"] +
                player["stats"]["recoverRate"] * dt,
            )

    def ball_hits_player(self, ball, player):
        shield_radius = player["stats"]["shieldRadius"]
        shield_offset_z = 1.2  # if player["side"] == "p1" else -1.2
        shield_center_y = 1.8

        shield_x = player["x"]
        shield_y = shield_center_y
        shield_z = player["z"] + shield_offset_z

        dx = ball["x"] - shield_x
        dy = ball["y"] - shield_y
        dz = ball["z"] - shield_z
        distance = math.sqrt(dx * dx + dy * dy + dz * dz)

        return distance <= shield_radius + ball["radius"]

    def reflect_ball(self, ball, player):
        shield_offset_z = 1.2  # if player["side"] == "p1" else -1.2
        shield_center_y = 1.8

        shield_x = player["x"]
        shield_y = shield_center_y
        shield_z = player["z"] + shield_offset_z

        dx = ball["x"] - shield_x
        dy = ball["y"] - shield_y
        dz = ball["z"] - shield_z

        length = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
        nx = dx / length
        nz = dz / length

        speed = player["stats"]["hitSpeed"]
        forward_z = 1.0 if player["side"] == "p1" else -1.0

        ball["vx"] = clamp(nx * speed * 0.9, -12.0, 12.0)
        ball["vz"] = abs(speed * max(0.65, abs(nz))) * forward_z
        ball["y"] = 2.0
        ball["vy"] = 0.0
        ball["lastHitBy"] = player["side"]

    def maybe_trigger_unkind_chase(self, loser, scorer):
        if loser["stats"]["kindness"] >= 3:
            return False

        if random.random() > 0.3:
            return False

        # wanted the duck to do some angry thing here, but the penalty just made things seem broken
        # scorer["score"] += 1
        # loser["chaseTimer"] = 1.5

        loser_name = loser["duck"].get(
            "name", loser["name"]) if loser["duck"] else loser["name"]
        self.lastEventMessage = f"{loser_name} got mad and chased the opponent!"
        return True

    def score_point(self, scorer_side):
        scorer = self.players[scorer_side]
        loser_side = "p2" if scorer_side == "p1" else "p1"
        loser = self.players[loser_side]

        scorer["score"] += 1
        self.lastScorer = scorer_side
        self.lastEventMessage = f'{scorer["name"]} scored!'

        self.maybe_trigger_unkind_chase(loser, scorer)

        if self.players["p1"]["score"] >= WIN_SCORE or self.players["p2"]["score"] >= WIN_SCORE:
            self.phase = "gameover"
            self.winner = "p1" if self.players["p1"]["score"] >= WIN_SCORE else "p2"
            winner_name = self.players[self.winner]["name"]
            self.lastEventMessage = f"{winner_name} wins!"
            return True

        self.phase = "waiting_serve"
        self.serveToward = scorer_side
        self.serveWaitingFor = loser_side

        self.reset_positions()
        self.reset_ball(self.serveToward)

        loser_name = loser["name"]
        self.lastEventMessage = f"{loser_name}: press serve key."
        return True

    def update_ball(self, dt):
        ball = self.ball

        ball["x"] += ball["vx"] * dt
        ball["y"] = 2.0
        ball["z"] += ball["vz"] * dt

        if ball["x"] - ball["radius"] <= -COURT["width"] / 2:
            ball["x"] = -COURT["width"] / 2 + ball["radius"]
            ball["vx"] *= -1

        if ball["x"] + ball["radius"] >= COURT["width"] / 2:
            ball["x"] = COURT["width"] / 2 - ball["radius"]
            ball["vx"] *= -1

        if ball["vz"] < 0 and self.ball_hits_player(ball, self.players["p1"]):
            self.reflect_ball(ball, self.players["p1"])
            ball["z"] = self.players["p1"]["z"] + 2.2

        if ball["vz"] > 0 and self.ball_hits_player(ball, self.players["p2"]):
            self.reflect_ball(ball, self.players["p2"])
            ball["z"] = self.players["p2"]["z"] - 2.2

        if ball["z"] < -COURT["depth"] / 2:
            return self.score_point("p2")

        if ball["z"] > COURT["depth"] / 2:
            return self.score_point("p1")

        return False

    def tick(self):
        now = time.time()
        dt = min(now - self.lastTick, 0.05)
        self.lastTick = now

        # No movement at all until both ducks are present
        if self.phase == "waiting_for_ducks":
            return False

        # Allow duck movement before serve and during live play
        if self.phase in ("waiting_serve", "playing"):
            self.update_player(self.players["p1"], dt)
            self.update_player(self.players["p2"], dt)

        # Ball only moves during live play
        if self.phase == "playing":
            return self.update_ball(dt)

        return False
