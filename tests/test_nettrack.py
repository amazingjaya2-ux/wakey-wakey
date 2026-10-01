import json
import threading
import time
import urllib.request

from nettrack import collector
from nettrack.dashboard import serve
from nettrack.recorder import Recorder
from nettrack.storage import Storage


def test_diff_counters_handles_reset_and_new_iface():
    prev = {"eth0": (100, 200)}
    curr = {"eth0": (50, 260), "wlan0": (10, 10)}
    assert collector.diff_counters(prev, curr) == {"eth0": (0, 60), "wlan0": (0, 0)}


def test_human_bytes():
    assert collector.human_bytes(512) == "512 B"
    assert collector.human_bytes(2048) == "2.0 KB"


def test_storage_roundtrip(tmp_path):
    s = Storage(str(tmp_path / "t.db"))
    now = time.time()
    s.add_samples(now, {"eth0": (10, 20)})
    s.add_connections(now, [{"pid": 1, "process": "curl", "remote_ip": "1.2.3.4",
                             "remote_port": 443, "proto": "tcp"}])
    assert s.totals_by_iface(now - 1) == [{"iface": "eth0", "sent": 10, "recv": 20}]
    assert s.top_talkers(now - 1, by="remote")[0]["name"] == "1.2.3.4"


def test_recorder_and_dashboard(tmp_path):
    s = Storage(str(tmp_path / "t.db"))
    rec = Recorder(s, interval=0.1, conn_every=1)
    rec.start()
    server = serve(s, port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    time.sleep(0.5)
    port = server.server_address[1]
    data = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/summary?minutes=5"))
    assert {"timeseries", "interfaces", "processes", "hosts"} <= data.keys()
    assert b"nettrack" in urllib.request.urlopen(f"http://127.0.0.1:{port}/").read()
    rec.stop()
    rec.join(timeout=2)
    server.shutdown()
