"""Reads traffic counters and active connections from the local machine."""

import psutil


def read_counters():
    """Cumulative (bytes_sent, bytes_recv) per network interface."""
    return {
        name: (c.bytes_sent, c.bytes_recv)
        for name, c in psutil.net_io_counters(pernic=True).items()
    }


def diff_counters(prev, curr):
    """Bytes transferred between two counter readings.

    Interfaces that appeared since `prev` count from zero; a counter that went
    backwards (interface reset, reboot) is treated as 0 rather than negative.
    """
    deltas = {}
    for iface, (sent, recv) in curr.items():
        p_sent, p_recv = prev.get(iface, (sent, recv))
        deltas[iface] = (max(sent - p_sent, 0), max(recv - p_recv, 0))
    return deltas


def snapshot_connections():
    """Established connections with a remote end, tagged with the owning process.

    On some systems (notably macOS) listing other users' connections needs
    elevated privileges; if access is denied we return what we can see.
    """
    try:
        conns = psutil.net_connections(kind="inet")
    except (psutil.AccessDenied, PermissionError):
        return []

    names = {}
    result = []
    for c in conns:
        if not c.raddr or c.status not in (psutil.CONN_ESTABLISHED, psutil.CONN_NONE):
            continue
        pid = c.pid
        if pid is not None and pid not in names:
            try:
                names[pid] = psutil.Process(pid).name()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                names[pid] = "?"
        result.append({
            "pid": pid,
            "process": names.get(pid, "?"),
            "remote_ip": c.raddr.ip,
            "remote_port": c.raddr.port,
            "proto": "tcp" if c.type == 1 else "udp",
        })
    return result


def human_bytes(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"
