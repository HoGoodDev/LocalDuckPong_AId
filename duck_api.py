import requests


DUCK_API_URL = "https://api.ducks.ects-cmp.com/ducks"


class DuckApi:
    def __init__(self):
        self._cache = None
        self._cache_by_id = {}

    def refresh(self):
        response = requests.get(DUCK_API_URL, timeout=10)
        response.raise_for_status()
        ducks = response.json()
        self._cache = ducks
        self._cache_by_id = {str(d["_id"]): d for d in ducks if "_id" in d}
        return ducks

    def get_all(self):
        if self._cache is None:
            self.refresh()
        return self._cache

    def get_by_id(self, duck_id):
        if self._cache is None:
            self.refresh()

        duck = self._cache_by_id.get(str(duck_id))
        if duck is not None:
            return duck

        self.refresh()
        return self._cache_by_id.get(str(duck_id))
