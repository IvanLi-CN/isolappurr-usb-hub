import { useMemo, useRef, useState } from "react";

import {
  type DesktopAgent,
  tryBootstrapDesktopAgent,
} from "../../domain/desktopAgent";
import {
  type FirmwareFlashProgress,
  flashWithNativeProxy,
  flashWithWebSerial,
  isWebSerialSupported,
  listNativeSerialPorts,
  type SerialPortInfo,
  sendNativeJsonlRequest,
  WebSerialJsonlTransport,
} from "../../domain/hardwareConsole";

type ConnectionMode = "web_serial" | "native_proxy" | "wifi_http";
type ConsoleStatus = "disconnected" | "connected" | "busy" | "error";

export type HardwareConsolePanelProps = {
  initialMode?: ConnectionMode;
  initialStatus?: ConsoleStatus;
  initialPorts?: SerialPortInfo[];
  initialLog?: string[];
};

const commandLabels = [
  ["info", "Info"],
  ["ports.get", "Ports"],
  ["wifi.get", "Wi-Fi"],
] as const;

export function HardwareConsolePanel({
  initialMode = "web_serial",
  initialStatus = "disconnected",
  initialPorts = [],
  initialLog = [],
}: HardwareConsolePanelProps) {
  const [mode, setMode] = useState<ConnectionMode>(initialMode);
  const [status, setStatus] = useState<ConsoleStatus>(initialStatus);
  const [log, setLog] = useState<string[]>(initialLog);
  const [ports, setPorts] = useState<SerialPortInfo[]>(initialPorts);
  const [selectedPort, setSelectedPort] = useState(initialPorts[0]?.path ?? "");
  const [ssid, setSsid] = useState("");
  const [psk, setPsk] = useState("");
  const [httpBaseUrl, setHttpBaseUrl] = useState("http://isolapurr.local");
  const [flashAddress, setFlashAddress] = useState("0x0");
  const [selectedFirmware, setSelectedFirmware] = useState<File | null>(null);
  const [flashProgress, setFlashProgress] =
    useState<FirmwareFlashProgress | null>(null);
  const webSerialRef = useRef<WebSerialJsonlTransport | null>(null);
  const requestIdRef = useRef(1);

  const webSerialSupported = useMemo(() => isWebSerialSupported(), []);
  const connected = status === "connected";

  function appendLog(message: string) {
    setLog((items) => [message, ...items].slice(0, 10));
  }

  async function withBusy(task: () => Promise<void>) {
    setStatus("busy");
    try {
      await task();
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      appendLog(err instanceof Error ? err.message : String(err));
    }
  }

  async function getAgent(): Promise<DesktopAgent> {
    const agent = await tryBootstrapDesktopAgent();
    if (!agent) {
      throw new Error("Desktop native proxy is not running");
    }
    return agent;
  }

  async function connect() {
    await withBusy(async () => {
      if (mode === "web_serial") {
        const transport = new WebSerialJsonlTransport();
        await transport.connect();
        webSerialRef.current = transport;
        appendLog("Web Serial connected");
        return;
      }
      if (mode === "native_proxy") {
        const agent = await getAgent();
        const nextPorts = await listNativeSerialPorts(agent);
        setPorts(nextPorts);
        setSelectedPort((current) => current || nextPorts[0]?.path || "");
        appendLog(`Native proxy ready: ${nextPorts.length} serial port(s)`);
        return;
      }
      appendLog(`HTTP transport target ${httpBaseUrl}`);
    });
  }

  async function disconnect() {
    await webSerialRef.current?.disconnect();
    webSerialRef.current = null;
    setStatus("disconnected");
    appendLog("Disconnected");
  }

  async function sendCommand(method: string, params?: Record<string, unknown>) {
    await withBusy(async () => {
      const request = { id: requestIdRef.current++, method, params };
      let response: unknown;
      if (mode === "web_serial") {
        if (!webSerialRef.current) {
          throw new Error("Connect to Web Serial first");
        }
        response = await webSerialRef.current?.request(request);
      } else if (mode === "native_proxy") {
        if (!selectedPort) {
          throw new Error("Select a serial port first");
        }
        response = await sendNativeJsonlRequest(
          await getAgent(),
          selectedPort,
          request,
        );
      } else {
        response = await sendHttpRequest(method, params);
      }
      appendLog(`${method}: ${JSON.stringify(response)}`);
    });
  }

  async function sendHttpRequest(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === "info") {
      return fetchJson(`${httpBaseUrl}/api/v1/info`);
    }
    if (method === "ports.get") {
      return fetchJson(`${httpBaseUrl}/api/v1/ports`);
    }
    if (method === "port.replug") {
      const port = String(params?.port ?? "port_a");
      return fetchJson(
        `${httpBaseUrl}/api/v1/ports/${encodeURIComponent(port)}/actions/replug`,
        { method: "POST" },
      );
    }
    if (method === "port.power_set") {
      const port = String(params?.port ?? "port_a");
      const enabled = params?.enabled ? "1" : "0";
      return fetchJson(
        `${httpBaseUrl}/api/v1/ports/${encodeURIComponent(port)}/power?enabled=${enabled}`,
        { method: "POST" },
      );
    }
    if (method === "wifi.get") {
      return fetchJson(`${httpBaseUrl}/api/v1/wifi`);
    }
    if (method === "wifi.set") {
      return fetchJson(`${httpBaseUrl}/api/v1/wifi/set`, {
        method: "POST",
        body: JSON.stringify({
          ssid: String(params?.ssid ?? ""),
          psk: String(params?.psk ?? ""),
        }),
      });
    }
    if (method === "wifi.clear") {
      return fetchJson(`${httpBaseUrl}/api/v1/wifi/clear`, {
        method: "POST",
      });
    }
    if (method === "reboot") {
      return fetchJson(`${httpBaseUrl}/api/v1/reboot`, { method: "POST" });
    }
    return { method, params, accepted: false };
  }

  async function configureWifi() {
    await sendCommand("wifi.set", { ssid, psk });
  }

  async function clearWifi() {
    await sendCommand("wifi.clear");
    setSsid("");
    setPsk("");
  }

  async function flashFirmware(file: File | null) {
    if (!file) {
      appendLog("Select a firmware .bin first");
      return;
    }
    await withBusy(async () => {
      if (mode === "native_proxy") {
        if (!selectedPort) {
          throw new Error("Select a serial port first");
        }
        const output = await flashWithNativeProxy(
          await getAgent(),
          selectedPort,
          file,
          Number.parseInt(flashAddress, 16),
        );
        appendLog(output || "Native flash completed");
        return;
      }
      if (mode !== "web_serial") {
        throw new Error("Browser flashing requires Web Serial or native proxy");
      }
      await flashWithWebSerial(
        file,
        Number.parseInt(flashAddress, 16),
        setFlashProgress,
      );
      appendLog("Browser flash completed");
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 min-[980px]:flex-row min-[980px]:items-end min-[980px]:justify-between">
        <div>
          <div className="text-[18px] font-bold">Hardware console</div>
          <div className="mt-1 text-[13px] font-semibold text-[var(--muted)]">
            Flash, provision Wi-Fi, inspect telemetry, and control ports
          </div>
        </div>
        <div className="flex min-h-10 flex-wrap items-center gap-2">
          <StatusPill status={status} />
          <button
            className="btn btn-sm"
            type="button"
            onClick={connected ? disconnect : connect}
          >
            {connected ? "Disconnect" : "Connect"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1180px]:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="iso-card rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="grid grid-cols-1 gap-3 min-[820px]:grid-cols-3">
            <label className="flex flex-col gap-1 text-[12px] font-bold text-[var(--muted)]">
              Transport
              <select
                className="select select-sm w-full"
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value as ConnectionMode)
                }
              >
                <option value="web_serial">Web Serial</option>
                <option value="native_proxy">Desktop native proxy</option>
                <option value="wifi_http">Wi-Fi HTTP</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-bold text-[var(--muted)]">
              Serial port
              <select
                className="select select-sm w-full"
                disabled={mode !== "native_proxy"}
                value={selectedPort}
                onChange={(event) => setSelectedPort(event.target.value)}
              >
                <option value="">Select after refresh</option>
                {ports.map((port) => (
                  <option key={port.path} value={port.path}>
                    {port.label} ({port.path})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-bold text-[var(--muted)]">
              Wi-Fi URL
              <input
                className="input input-sm w-full"
                value={httpBaseUrl}
                onChange={(event) => setHttpBaseUrl(event.target.value)}
                disabled={mode !== "wifi_http"}
              />
            </label>
          </div>

          {!webSerialSupported && mode === "web_serial" ? (
            <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] font-semibold text-[var(--warning)]">
              This browser does not expose Web Serial. Use Chrome/Edge or
              Desktop native proxy.
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {commandLabels.map(([method, label]) => (
              <button
                key={method}
                className="btn btn-sm"
                type="button"
                disabled={status === "busy"}
                onClick={() => void sendCommand(method)}
              >
                {label}
              </button>
            ))}
            <button
              className="btn btn-sm"
              type="button"
              disabled={status === "busy"}
              onClick={() =>
                void sendCommand("port.replug", { port: "port_a" })
              }
            >
              Replug USB-A
            </button>
            <button
              className="btn btn-sm"
              type="button"
              disabled={status === "busy"}
              onClick={() =>
                void sendCommand("port.power_set", {
                  port: "port_c",
                  enabled: true,
                })
              }
            >
              Power USB-C
            </button>
          </div>
        </div>

        <div className="iso-card rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="text-[14px] font-bold">Wi-Fi provisioning</div>
          <div className="mt-3 grid grid-cols-1 gap-3 min-[640px]:grid-cols-2">
            <input
              className="input input-sm w-full"
              aria-label="Wi-Fi SSID"
              value={ssid}
              onChange={(event) => setSsid(event.target.value)}
              placeholder="SSID"
            />
            <input
              className="input input-sm w-full"
              aria-label="Wi-Fi password"
              type="password"
              value={psk}
              onChange={(event) => setPsk(event.target.value)}
              placeholder="Password"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn btn-sm btn-primary"
              type="button"
              disabled={!ssid || status === "busy"}
              onClick={() => void configureWifi()}
            >
              Save Wi-Fi
            </button>
            <button
              className="btn btn-sm"
              type="button"
              disabled={status === "busy"}
              onClick={() => void clearWifi()}
            >
              Clear
            </button>
            <button
              className="btn btn-sm"
              type="button"
              disabled={status === "busy"}
              onClick={() => void sendCommand("reboot")}
            >
              Reboot
            </button>
          </div>

          <div className="mt-5 text-[14px] font-bold">Firmware</div>
          <div className="mt-3 grid grid-cols-1 gap-3 min-[640px]:grid-cols-[1fr_96px]">
            <input
              className="file-input file-input-sm w-full"
              type="file"
              accept=".bin,application/octet-stream"
              onChange={(event) =>
                setSelectedFirmware(event.currentTarget.files?.[0] ?? null)
              }
            />
            <input
              className="input input-sm w-full"
              aria-label="Flash address"
              value={flashAddress}
              onChange={(event) => setFlashAddress(event.target.value)}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              className="btn btn-sm btn-primary"
              type="button"
              disabled={!selectedFirmware || status === "busy"}
              onClick={() => void flashFirmware(selectedFirmware)}
            >
              Flash firmware
            </button>
            <div className="text-[12px] font-semibold text-[var(--muted)]">
              {selectedFirmware ? selectedFirmware.name : "No .bin selected"}
            </div>
          </div>
          {flashProgress ? (
            <div className="mt-2 text-[12px] font-semibold text-[var(--muted)]">
              {flashProgress.message}
              {flashProgress.total
                ? ` ${Math.round(((flashProgress.written ?? 0) / flashProgress.total) * 100)}%`
                : ""}
            </div>
          ) : null}
        </div>
      </div>

      <div className="iso-card min-h-[132px] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="text-[14px] font-bold">Console log</div>
        <div className="mt-3 grid gap-2 text-[12px] font-semibold text-[var(--muted)]">
          {log.length === 0 ? <div>No commands yet</div> : null}
          {log.map((item) => (
            <div className="truncate" key={item}>
              {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: ConsoleStatus }) {
  const tone =
    status === "connected"
      ? "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]"
      : status === "error"
        ? "bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]"
        : status === "busy"
          ? "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]"
          : "bg-[var(--panel-2)] text-[var(--muted)]";
  return (
    <span className={`rounded-md px-2.5 py-1 text-[12px] font-bold ${tone}`}>
      {status}
    </span>
  );
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP request failed (${res.status})`);
  }
  return res.json();
}
