"""Check AI portal layout at desktop, tablet and mobile viewport sizes."""
import json
import time
import urllib.request

import websocket


with urllib.request.urlopen("http://127.0.0.1:9230/json", timeout=5) as response:
    page = next(item for item in json.load(response) if item.get("type") == "page" and "127.0.0.1:8766" in item.get("url", ""))
ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=20)
counter = 0


def command(method, params=None):
    global counter
    counter += 1
    ws.send(json.dumps({"id": counter, "method": method, "params": params or {}}))
    while True:
        message = json.loads(ws.recv())
        if message.get("id") == counter:
            return message["result"]


def evaluate(expression):
    return command("Runtime.evaluate", {"expression": expression, "returnByValue": True})["result"].get("value")


command("Page.navigate", {"url": f"http://127.0.0.1:8766/index.html?fresh=layout-test-{int(time.time())}"})
time.sleep(4)
for width, height, mobile in ((1440, 900, False), (900, 900, False), (390, 844, True)):
    command("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": mobile})
    evaluate("switchTab('aitrend');renderAITrendSummary()")
    time.sleep(1)
    result = json.loads(evaluate("JSON.stringify({viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,cardWidth:(document.querySelector('.ai-pu-card')||{}).clientWidth||0,layout:getComputedStyle(document.querySelector('.ai-decision-layout')).gridTemplateColumns,kpis:getComputedStyle(document.querySelector('.ai-kpi-row')).gridTemplateColumns,overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:Math.round(e.getBoundingClientRect().right),width:Math.round(e.getBoundingClientRect().width)})),month:(document.getElementById('aiTrendMeta')||{}).textContent||''})"))
    print(width, result)
    if result["pageWidth"] > result["viewport"] + 1:
        raise RuntimeError(f"Horizontal page overflow at {width}px: {result}")
    if result["cardWidth"] <= 0:
        raise RuntimeError(f"AI card did not render at {width}px")

command("Emulation.clearDeviceMetricsOverride")
ws.close()
