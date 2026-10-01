"""Command line interface: live view, recording, reports and dashboard."""

import argparse
import sys
import time

from . import collector
from .dashboard import serve
from .recorder import Recorder
from .storage import Storage


def cmd_live(args):
    """Print per-interface speed in the terminal, like a tiny `nload`."""
    prev = collector.read_counters()
    print(f"{'interface':<16}{'down/s':>12}{'up/s':>12}   (Ctrl+C to stop)")
    try:
        while True:
            time.sleep(args.interval)
            curr = collector.read_counters()
            for iface, (sent, recv) in collector.diff_counters(prev, curr).items():
                if sent or recv:
                    print(f"{iface:<16}{collector.human_bytes(recv / args.interval):>10}/s"
                          f"{collector.human_bytes(sent / args.interval):>10}/s")
            print("-" * 40)
            prev = curr
    except KeyboardInterrupt:
        pass


def cmd_record(args):
    store = Storage(args.db)
    rec = Recorder(store, interval=args.interval)
    rec.start()
    print(f"Recording to {args.db} every {args.interval}s. Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        rec.stop()
        rec.join()


def cmd_report(args):
    store = Storage(args.db)
    since = time.time() - args.hours * 3600
    print(f"Traffic in the last {args.hours} hour(s):\n")
    for row in store.totals_by_iface(since):
        print(f"  {row['iface']:<16} down {collector.human_bytes(row['recv']):>10}"
              f"   up {collector.human_bytes(row['sent']):>10}")
    print("\nMost active programs:")
    for row in store.top_talkers(since, by="process"):
        print(f"  {row['name']:<28} seen {row['seen']}x")
    print("\nMost contacted remote hosts:")
    for row in store.top_talkers(since, by="remote"):
        print(f"  {row['name']:<28} seen {row['seen']}x")


def cmd_dashboard(args):
    store = Storage(args.db)
    rec = Recorder(store, interval=args.interval)
    rec.start()
    server = serve(store, args.host, args.port)
    print(f"Dashboard: http://{args.host}:{args.port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        rec.stop()
        server.server_close()


def main(argv=None):
    p = argparse.ArgumentParser(prog="nettrack", description="Track network traffic on this device.")
    sub = p.add_subparsers(dest="cmd", required=True)

    live = sub.add_parser("live", help="show live up/down speed per interface")
    live.add_argument("--interval", type=float, default=1.0)
    live.set_defaults(func=cmd_live)

    for name, func, help_ in (("record", cmd_record, "log traffic to the database"),
                              ("report", cmd_report, "summarise recorded traffic"),
                              ("dashboard", cmd_dashboard, "record + serve a web dashboard")):
        s = sub.add_parser(name, help=help_)
        s.add_argument("--db", default="nettrack.db")
        if name != "report":
            s.add_argument("--interval", type=float, default=2.0)
        if name == "report":
            s.add_argument("--hours", type=float, default=24)
        if name == "dashboard":
            s.add_argument("--host", default="127.0.0.1")
            s.add_argument("--port", type=int, default=8080)
        s.set_defaults(func=func)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
