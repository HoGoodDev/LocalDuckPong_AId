import os
from copy import deepcopy

from duck_api import DuckApi
from nfc_portal import NfcPortalManager


class ReaderService:
    """
    Uses nfc_portal.py to read two NFC portals and map them to p1 / p2.

    Expected behavior:
    - starts NfcPortalManager in the background
    - reads current portal states
    - assigns one reader to p1 and one reader to p2
    - extracts duck id from each portal via portal_state.get_id()
    - loads full duck object from DuckApi

    Optional environment variables:
    - NFC_SIM_MODE=1
        Use simulation mode from nfc_portal.py

    - P1_READER_NAME="Exact Reader Name"
    - P2_READER_NAME="Exact Reader Name"
        Force specific physical readers to map to player 1 / player 2

    If P1_READER_NAME / P2_READER_NAME are not set, the first two
    detected reader names in sorted order will be used.
    """

    def __init__(self):
        self.duck_api = DuckApi()

        self.simulation_mode = os.getenv("NFC_SIM_MODE", "0") == "1"
        self.p1_reader_name = os.getenv("P1_READER_NAME")
        self.p2_reader_name = os.getenv("P2_READER_NAME")

        self.manager = NfcPortalManager(
            poll_interval_seconds=0.20,
            memory_page_end_inclusive=0x40,
            simulation_mode=self.simulation_mode,
        )
        self.manager.start()

        self._last_state = {
            "p1": {
                "reader_name": self.p1_reader_name or "Reader 1",
                "card_present": False,
                "duck_id": None,
                "duck": None,
            },
            "p2": {
                "reader_name": self.p2_reader_name or "Reader 2",
                "card_present": False,
                "duck_id": None,
                "duck": None,
            },
        }

    def stop(self):
        try:
            self.manager.stop()
        except Exception:
            pass

    def get_state(self):
        """
        Return current reader/duck state in the format expected by the game.
        """
        try:
            portal_states = self.manager.get_current_states()
            return self._build_reader_state(portal_states)
        except Exception as e:
            print(f"[ReaderService] get_state error: {e}")
            return deepcopy(self._last_state)

    def _build_reader_state(self, portal_states):
        """
        portal_states is expected to be a dict like:
            {
                "Reader Name 1": PortalState(...),
                "Reader Name 2": PortalState(...),
            }
        """
        p1_state, p2_state = self._choose_portals(portal_states)

        new_state = {
            "p1": self._portal_to_player_state("p1", p1_state),
            "p2": self._portal_to_player_state("p2", p2_state),
        }

        self._last_state = deepcopy(new_state)
        return new_state

    def _choose_portals(self, portal_states):
        """
        Decide which portal maps to p1 and which maps to p2.

        Priority:
        1. explicit env var names
        2. first two reader names in sorted order
        """
        if not portal_states:
            return None, None

        names = sorted(portal_states.keys())

        p1_state = None
        p2_state = None

        # Explicit mapping if environment variables are set
        if self.p1_reader_name and self.p1_reader_name in portal_states:
            p1_state = portal_states[self.p1_reader_name]

        if self.p2_reader_name and self.p2_reader_name in portal_states:
            p2_state = portal_states[self.p2_reader_name]

        # Fallback to sorted order
        if p1_state is None and len(names) >= 1:
            p1_state = portal_states[names[0]]

        if p2_state is None and len(names) >= 2:
            for name in names:
                if p1_state is None or name != p1_state.reader_name:
                    p2_state = portal_states[name]
                    break

        return p1_state, p2_state

    def _portal_to_player_state(self, side, portal_state):
        """
        Convert a PortalState from nfc_portal.py into the player-state shape
        used by the rest of the game.
        """
        default_reader_name = self._last_state[side]["reader_name"]

        if portal_state is None:
            return {
                "reader_name": default_reader_name,
                "card_present": False,
                "duck_id": None,
                "duck": None,
            }

        duck_id = None
        duck = None

        if portal_state.has_tag():
            try:
                duck_id = portal_state.get_id()
            except Exception as e:
                print(
                    f"[ReaderService] could not read duck id for {side}: {e}")

        if duck_id:
            try:
                duck = self.duck_api.get_by_id(duck_id)
            except Exception as e:
                print(f"[ReaderService] duck lookup failed for {duck_id}: {e}")

        return {
            "reader_name": getattr(portal_state, "reader_name", default_reader_name),
            "card_present": duck is not None,
            "duck_id": duck_id if duck is not None else None,
            "duck": duck,
        }

    def stop(self):
        try:
            if hasattr(self, "manager") and self.manager:
                self.manager.stop()
        except Exception as e:
            print("[ReaderService] error stopping manager:", e)
