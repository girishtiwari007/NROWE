import json
import pathlib
import time
import urllib.request

import websocket


def targets():
    with urllib.request.urlopen("http://127.0.0.1:9230/json", timeout=5) as response:
        return json.load(response)


page = next(item for item in targets() if item.get("type") == "page" and "127.0.0.1:8766" in item.get("url", ""))
ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10)
counter = 0


def command(method, params=None):
    global counter
    counter += 1
    ws.send(json.dumps({"id": counter, "method": method, "params": params or {}}))
    while True:
        message = json.loads(ws.recv())
        if message.get("id") == counter:
            return message


command("Runtime.enable")
command("Page.enable")
time.sleep(3)
download_dir = pathlib.Path(__file__).resolve().parent.parent / ".export-validation"
download_dir.mkdir(exist_ok=True)
command("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(download_dir)})
result = command("Runtime.evaluate", {
    "expression": "sessionStorage.setItem('rlp_export_user_access','1');window.confirm=()=>true; Promise.all([window.downloadExcel(),window.downloadPDFReport(),window.downloadPowerPoint()]).then(()=>JSON.stringify({ready:document.readyState,url:location.href,ppt:typeof window.downloadPowerPoint,excel:typeof window.downloadExcel,pdf:typeof window.downloadPDFReport,status:document.body.dataset.exportStatus,freshness:document.body.dataset.exportFreshness}))",
    "awaitPromise": True,
    "returnByValue": True,
})
print(result["result"]["result"].get("value", result))
time.sleep(8)
print("downloads", sorted(item.name for item in download_dir.iterdir()))
ws.close()
