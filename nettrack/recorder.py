"""Background loop that samples traffic and writes it to storage."""

import threading
import time

from . import collector


class Recorder(threading.Thread):
    def __init__(self, storage, interval=2.0, conn_every=5):
        super().__init__(daemon=True)
        self.storage = storage
        self.interval = interval
        self.conn_every = conn_every  # snapshot connections every N samples
        self._halt = threading.Event()

    def run(self):
        prev = collector.read_counters()
        tick = 0
        while not self._halt.wait(self.interval):
            curr = collector.read_counters()
            now = time.time()
            self.storage.add_samples(now, collector.diff_counters(prev, curr))
            prev = curr
            tick += 1
            if tick % self.conn_every == 0:
                self.storage.add_connections(now, collector.snapshot_connections())

    def stop(self):
        self._halt.set()
