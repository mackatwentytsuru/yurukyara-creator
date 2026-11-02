"""Pixel Streaming の signalling を 1 ファイルで。Python の websockets だけで動く。

-game の UE には内蔵の signalling が無いので、これを先に起動する。ページ(player.html)も同じポートで出す。
  --streamer-port  UE がつなぐ(自分の機械だけ)
  --player-port    ブラウザがつなぐ。http://<この機械>:<ポート>/ でページが開く
ページからの測定の記録は --out のフォルダに書く。
"""
import argparse
import asyncio
import base64
import http
import json
import time
from pathlib import Path

from websockets.asyncio.server import serve
from websockets.datastructures import Headers
from websockets.http11 import Response

HERE = Path(__file__).resolve().parent
MAX_MESSAGE = 16 * 1024 * 1024


class Hub:
    def __init__(self, out_dir):
        self.streamers = {}  # id → 接続
        self.players = {}  # 番号 → 接続
        self.subscribed = {}  # プレイヤーの番号 → 配信の id
        self.next_player = 100
        self.out_dir = Path(out_dir) if out_dir else None

    async def handle_streamer(self, connection):
        streamer_id = f"streamer{len(self.streamers)}"
        self.streamers[streamer_id] = connection
        print("streamer connected", flush=True)
        await connection.send(json.dumps({"type": "config", "peerConnectionOptions": {}}))
        await connection.send(json.dumps({"type": "identify"}))
        try:
            async for raw in connection:
                message = json.loads(raw)
                kind = message.get("type")
                if kind == "endpointId":
                    del self.streamers[streamer_id]
                    streamer_id = message["id"]
                    self.streamers[streamer_id] = connection
                    print("streamer id", streamer_id, flush=True)
                    await connection.send(json.dumps({"type": "endpointIdConfirm", "committedId": streamer_id}))
                elif kind == "ping":
                    await connection.send(json.dumps({"type": "pong", "time": time.time()}))
                elif kind == "disconnectPlayer":
                    player = self.players.get(int(message["playerId"]))
                    if player:
                        await player.close()
                elif "playerId" in message:
                    player = self.players.get(int(message.pop("playerId")))
                    if player:
                        await player.send(json.dumps(message))
                else:
                    print("streamer message ignored:", kind, flush=True)
        finally:
            self.streamers.pop(streamer_id, None)
            print("streamer disconnected", flush=True)

    async def subscribe(self, player_id, streamer_id):
        streamer = self.streamers.get(streamer_id)
        if streamer is None:
            return
        self.subscribed[player_id] = streamer_id
        print("player", player_id, "subscribed", flush=True)
        await streamer.send(json.dumps({"type": "playerConnected", "playerId": str(player_id), "dataChannel": True,
                                        "sfu": False, "sendOffer": True}))

    def save_from_page(self, message, player_id):
        if not self.out_dir:
            return
        if message["type"] == "liveLog":
            (self.out_dir / f"player_log_{player_id}.json").write_text(json.dumps(message["data"]), encoding="utf-8")
        else:
            image = base64.b64decode(message["jpeg"].split(",", 1)[1])
            (self.out_dir / f"frame_{player_id}_{int(message['at'])}.jpg").write_bytes(image)

    async def handle_player(self, connection):
        player_id = self.next_player
        self.next_player += 1
        self.players[player_id] = connection
        await connection.send(json.dumps({"type": "config", "peerConnectionOptions": {}}))
        try:
            async for raw in connection:
                message = json.loads(raw)
                kind = message.get("type")
                if kind == "listStreamers":
                    await connection.send(json.dumps({"type": "streamerList", "ids": list(self.streamers)}))
                elif kind == "subscribe":
                    await self.subscribe(player_id, message["streamerId"])
                elif kind == "ping":
                    await connection.send(json.dumps({"type": "pong", "time": time.time()}))
                elif kind == "timeReq":
                    await connection.send(json.dumps({"type": "timeRes", "sent": message["sent"],
                                                      "ms": time.time() * 1000.0}))
                elif kind in ("liveLog", "liveFrame"):
                    self.save_from_page(message, player_id)
                else:
                    streamer = self.streamers.get(self.subscribed.get(player_id, ""))
                    if streamer:
                        message["playerId"] = str(player_id)
                        await streamer.send(json.dumps(message))
        finally:
            self.players.pop(player_id, None)
            streamer = self.streamers.get(self.subscribed.pop(player_id, ""))
            if streamer:
                await streamer.send(json.dumps({"type": "playerDisconnected", "playerId": str(player_id)}))


def serve_page(connection, request):
    if request.headers.get("Upgrade", "").lower() == "websocket":
        return None
    if request.path.split("?")[0] not in ("/", "/player.html"):
        return connection.respond(http.HTTPStatus.NOT_FOUND, "not found\n")
    body = (HERE / "player.html").read_bytes()
    headers = Headers([("Content-Type", "text/html; charset=utf-8"), ("Content-Length", str(len(body))),
                       ("Cache-Control", "no-store")])
    return Response(200, "OK", headers, body)


async def main_async(args):
    hub = Hub(args.out)
    if args.out:
        Path(args.out).mkdir(parents=True, exist_ok=True)
    async with serve(hub.handle_streamer, "127.0.0.1", args.streamer_port, max_size=MAX_MESSAGE):
        async with serve(hub.handle_player, args.bind, args.player_port, process_request=serve_page,
                         max_size=MAX_MESSAGE):
            print(f"signalling ready streamer=127.0.0.1:{args.streamer_port} player={args.bind}:{args.player_port}",
                  flush=True)
            await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--streamer-port", type=int, default=8888)
    parser.add_argument("--player-port", type=int, default=8080)
    parser.add_argument("--bind", default="127.0.0.1", help="端末から見るときは 0.0.0.0")
    parser.add_argument("--out")
    asyncio.run(main_async(parser.parse_args()))
