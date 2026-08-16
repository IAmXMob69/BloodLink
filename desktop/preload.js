const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("hearth", {
  desktop: true,
  serverUrl: "",
  platform: process.platform,
});
