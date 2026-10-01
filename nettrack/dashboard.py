"""Tiny local web dashboard (standard library only)."""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>nettrack</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
 body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#fafafa;color:#222}
 h1{margin:0 0 12px;font-size:20px} h2{font-size:15px;margin:20px 0 6px}
 canvas{background:#fff;border:1px solid #ddd;width:100%;max-width:900px;height:240px}
 table{border-collapse:collapse;background:#fff;font-size:13px;min-width:320px}
 td,th{border:1px solid #ddd;padding:4px 10px;text-align:left}
 .legend span{margin-right:14px;font-size:13px}
 select{font-size:14px;margin-left:8px}
</style></head><body>
<h1>Network traffic <select id="range">
 <option value="5">last 5 min</option><option value="60" selected>last hour</option>
 <option value="1440">last 24 h</option></select></h1>
<div class="legend"><span style="color:#2a7de1">&#9632; download</span>
<span style="color:#e1792a">&#9632; upload</span></div>
<canvas id="chart" width="900" height="240"></canvas>
<h2>By interface</h2><table id="ifaces"></table>
<h2>Most active programs</h2><table id="procs"></table>
<h2>Most contacted remote hosts</h2><table id="hosts"></table>
<script>
const fmt=n=>{for(const u of ['B','KB','MB','GB']){if(n<1024)return n.toFixed(u=='B'?0:1)+' '+u;n/=1024}return n.toFixed(1)+' TB'};
const esc=s=>String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
function table(id,head,rows){document.getElementById(id).innerHTML=
 '<tr>'+head.map(h=>'<th>'+h+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')}
function draw(series){
 const c=document.getElementById('chart'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);
 if(!series.length)return;
 const max=Math.max(1,...series.map(p=>Math.max(p.sent,p.recv))),pad=40,w=c.width-pad-10,h=c.height-30;
 g.fillStyle='#666';g.font='11px sans-serif';g.fillText(fmt(max),2,14);g.fillText('0',2,h+4);
 [['recv','#2a7de1'],['sent','#e1792a']].forEach(([k,col])=>{
  g.strokeStyle=col;g.lineWidth=2;g.beginPath();
  series.forEach((p,i)=>{const x=pad+(series.length>1?i/(series.length-1):0)*w,y=h-(p[k]/max)*(h-14);i?g.lineTo(x,y):g.moveTo(x,y)});g.stroke()})}
async function refresh(){
 const m=document.getElementById('range').value;
 const d=await (await fetch('/api/summary?minutes='+m)).json();
 draw(d.timeseries);
 table('ifaces',['Interface','Sent','Received'],d.interfaces.map(i=>[i.iface,fmt(i.sent),fmt(i.recv)]));
 table('procs',['Program','Times seen'],d.processes.map(p=>[p.name,p.seen]));
 table('hosts',['Remote host','Times seen'],d.hosts.map(p=>[p.name,p.seen]))}
document.getElementById('range').onchange=refresh;refresh();setInterval(refresh,3000);
</script></body></html>"""


def make_handler(storage):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code, body, ctype):
            data = body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == "/":
                return self._send(200, PAGE, "text/html; charset=utf-8")
            if url.path == "/api/summary":
                try:
                    minutes = int(parse_qs(url.query).get("minutes", ["60"])[0])
                except ValueError:
                    return self._send(400, '{"error":"bad minutes"}', "application/json")
                minutes = max(1, min(minutes, 60 * 24 * 30))
                since = time.time() - minutes * 60
                bucket = max(2, minutes * 60 // 120)  # ~120 points per chart
                body = json.dumps({
                    "timeseries": storage.timeseries(since, bucket),
                    "interfaces": storage.totals_by_iface(since),
                    "processes": storage.top_talkers(since, by="process"),
                    "hosts": storage.top_talkers(since, by="remote"),
                })
                return self._send(200, body, "application/json")
            self._send(404, "not found", "text/plain")

        def log_message(self, *args):  # keep the terminal quiet
            pass

    return Handler


def serve(storage, host="127.0.0.1", port=8080):
    server = ThreadingHTTPServer((host, port), make_handler(storage))
    return server
