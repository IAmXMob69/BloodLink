const { app, BrowserWindow, shell, Menu } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const PORT = Number(process.env.HEARTH_PORT || 3928);
const DEV = process.argv.includes("--dev") || process.env.HEARTH_DEV === "1";
const DEV_URL = process.env.HEARTH_DEV_URL || "http://127.0.0.1:5173";

let win = null;
let serverProc = null;

function iconPath() {
  const candidates = [
    path.join(__dirname, "..", "assets", "icon.png"),
    path.join(process.resourcesPath || "", "icon.png"),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function serverEntry() {
  const packed = path.join(process.resourcesPath || "", "server", "src", "index.js");
  const dev = path.join(__dirname, "..", "server", "src", "index.js");
  return fs.existsSync(packed) ? packed : dev;
}

function waitFor(url, tries = 40) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (n <= 0) reject(new Error("Hearth server did not start"));
        else setTimeout(() => tick(n - 1), 250);
      });
    };
    tick(tries);
  });
}

function startServer() {
  if (DEV) return Promise.resolve();
  const entry = serverEntry();
  const env = {
    ...process.env,
    HEARTH_PORT: String(PORT),
    HEARTH_HOST: "127.0.0.1",
    HEARTH_DATA: path.join(app.getPath("userData"), "data"),
  };
  const clientPacked = path.join(process.resourcesPath || "", "client");
  if (fs.existsSync(path.join(clientPacked, "index.html"))) env.HEARTH_CLIENT = clientPacked;
  serverProc = spawn(process.execPath.includes("electron") ? "node" : process.execPath, [entry], {
    env,
    stdio: "inherit",
  });
  serverProc.on("exit", (code) => {
    if (code && win) console.error("Hearth server exited", code);
  });
  return waitFor(`http://127.0.0.1:${PORT}/api/health`);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: "#1e1f22",
    title: "Hearth",
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const url = DEV ? DEV_URL : `http://127.0.0.1:${PORT}`;
  win.loadURL(url);
  win.webContents.setWindowOpenHandler(({ url: next }) => {
    shell.openExternal(next);
    return { action: "deny" };
  });
  const menu = Menu.buildFromTemplate([
    {
      label: "Hearth",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (err) {
    console.error(err);
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (serverProc) serverProc.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProc) serverProc.kill();
});
