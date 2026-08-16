import { wsUrl } from "./api.js";
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
  };
  sock.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    applyEvent(msg);
    for (const h of handlers) h(msg);
  };
  sock.onclose = () => {
    setState({ connected: false });
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
