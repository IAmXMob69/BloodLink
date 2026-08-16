import { getToken, setToken, wsUrl } from "./api.js";
import { applyEvent, setState } from "./store.js";

let ws = null;
let ping = null;
let retries = 0;
const handlers = new Set();

export function onSocket(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

export function sendWs(payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

export function disconnect() {
  if (ping) clearInterval(ping);
  ping = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

export function connect() {
  disconnect();
  setState({ connecting: true, error: "" });
  const sock = new WebSocket(wsUrl());
  ws = sock;
  sock.onopen = () => {
    retries = 0;
    const tok = getToken();
    if (tok) sock.send(JSON.stringify({ type: "auth", token: tok }));
    if (ping) clearInterval(ping);
    ping = setInterval(() => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" }));
    }, 20000);
  };
  sock.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "pong") return;
    if (msg.type === "error" && /invalid token/i.test(msg.error || "")) {
      setToken("");
      setState({ token: "", me: null, connected: false, connecting: false, error: "Session expired. Sign in again." });
      disconnect();
      return;
    }
    applyEvent(msg);
    for (const h of handlers) h(msg);
  };
  sock.onclose = () => {
    if (ping) {
      clearInterval(ping);
      ping = null;
    }
    setState({
      connected: false,
      connecting: false,
      error: getToken() ? "Lost connection to BloodLink. Reconnecting…" : "",
    });
    if (ws === sock) {
      retries += 1;
      const wait = Math.min(8000, 500 * retries);
      setTimeout(() => {
        if (localStorage.getItem("hearth.token")) connect();
      }, wait);
    }
  };
  sock.onerror = () => {};
}

export function currentSocket() {
  return ws;
}
