#!/usr/bin/env python3

import argparse
import base64
import json
import sys
from typing import Any

import serial


def emit(request_id: int, *, result: Any = None, error: str | None = None) -> None:
    payload: dict[str, Any] = {"id": request_id}
    if error is None:
        payload["result"] = result
    else:
        payload["error"] = error
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bridge one explicitly selected serial path into Web Serial HIL."
    )
    parser.add_argument("--port", required=True)
    args = parser.parse_args()

    active: serial.Serial | None = None
    for raw_line in sys.stdin:
        try:
            request = json.loads(raw_line)
            request_id = int(request["id"])
            method = request["method"]
            params = request.get("params", {})

            if method == "open":
                if active is not None:
                    active.close()
                active = serial.Serial(
                    port=args.port,
                    baudrate=int(params.get("baudRate", 115200)),
                    timeout=0.02,
                    write_timeout=1,
                    exclusive=True,
                )
                emit(request_id, result=True)
            elif method == "close":
                if active is not None:
                    active.close()
                    active = None
                emit(request_id, result=True)
            elif method == "write":
                if active is None:
                    raise RuntimeError("serial port is not open")
                payload = base64.b64decode(params["data"])
                active.write(payload)
                active.flush()
                emit(request_id, result=len(payload))
            elif method == "read":
                if active is None:
                    raise RuntimeError("serial port is not open")
                payload = active.read(int(params.get("maxBytes", 4096)))
                emit(request_id, result=base64.b64encode(payload).decode("ascii"))
            elif method == "setSignals":
                if active is None:
                    raise RuntimeError("serial port is not open")
                if "dataTerminalReady" in params:
                    active.dtr = bool(params["dataTerminalReady"])
                if "requestToSend" in params:
                    active.rts = bool(params["requestToSend"])
                emit(request_id, result=True)
            else:
                raise RuntimeError(f"unsupported bridge method: {method}")
        except Exception as err:  # Keep protocol errors machine-readable for Playwright.
            emit(request.get("id", -1) if "request" in locals() else -1, error=str(err))

    if active is not None:
        active.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
