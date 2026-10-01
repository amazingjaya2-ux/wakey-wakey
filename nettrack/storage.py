"""SQLite storage for traffic samples and connection snapshots."""

import sqlite3
import threading
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS samples (
    ts         REAL NOT NULL,
    iface      TEXT NOT NULL,
    bytes_sent INTEGER NOT NULL,
    bytes_recv INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts);

CREATE TABLE IF NOT EXISTS connections (
    ts          REAL NOT NULL,
    pid         INTEGER,
    process     TEXT,
    remote_ip   TEXT NOT NULL,
    remote_port INTEGER NOT NULL,
    proto       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connections_ts ON connections(ts);
"""


class Storage:
    def __init__(self, path="nettrack.db"):
        # The recorder thread and the dashboard threads share one connection.
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(SCHEMA)

    def add_samples(self, ts, deltas):
        """deltas: {iface: (bytes_sent, bytes_recv)} transferred since last sample."""
        rows = [(ts, i, s, r) for i, (s, r) in deltas.items()]
        with self._lock:
            self._conn.executemany("INSERT INTO samples VALUES (?,?,?,?)", rows)
            self._conn.commit()

    def add_connections(self, ts, conns):
        rows = [(ts, c["pid"], c["process"], c["remote_ip"], c["remote_port"], c["proto"])
                for c in conns]
        with self._lock:
            self._conn.executemany("INSERT INTO connections VALUES (?,?,?,?,?,?)", rows)
            self._conn.commit()

    def timeseries(self, since, bucket=10):
        """Total bytes per time bucket (seconds) since `since`, summed across interfaces."""
        with self._lock:
            cur = self._conn.execute(
                "SELECT CAST(ts / ? AS INTEGER) * ? AS t, SUM(bytes_sent) AS sent, "
                "SUM(bytes_recv) AS recv FROM samples WHERE ts >= ? GROUP BY t ORDER BY t",
                (bucket, bucket, since),
            )
            return [dict(r) for r in cur]

    def totals_by_iface(self, since):
        with self._lock:
            cur = self._conn.execute(
                "SELECT iface, SUM(bytes_sent) AS sent, SUM(bytes_recv) AS recv "
                "FROM samples WHERE ts >= ? GROUP BY iface ORDER BY recv + sent DESC",
                (since,),
            )
            return [dict(r) for r in cur]

    def top_talkers(self, since, limit=10, by="process"):
        """Most frequently seen processes or remote hosts across connection snapshots."""
        col = {"process": "process", "remote": "remote_ip"}[by]
        with self._lock:
            cur = self._conn.execute(
                f"SELECT {col} AS name, COUNT(*) AS seen FROM connections "
                f"WHERE ts >= ? GROUP BY {col} ORDER BY seen DESC LIMIT ?",
                (since, limit),
            )
            return [dict(r) for r in cur]

    def recent_connections(self, limit=50):
        with self._lock:
            cur = self._conn.execute(
                "SELECT ts, process, pid, remote_ip, remote_port, proto FROM connections "
                "ORDER BY ts DESC LIMIT ?",
                (limit,),
            )
            return [dict(r) for r in cur]

    def prune(self, older_than_seconds):
        cutoff = time.time() - older_than_seconds
        with self._lock:
            self._conn.execute("DELETE FROM samples WHERE ts < ?", (cutoff,))
            self._conn.execute("DELETE FROM connections WHERE ts < ?", (cutoff,))
            self._conn.commit()

    def close(self):
        with self._lock:
            self._conn.close()
