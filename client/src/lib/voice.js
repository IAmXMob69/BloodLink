/** Voice through the BloodLink server only. No WebRTC — peers never learn each other's IPs. */
import { sendWs } from "./socket.js";
import { getState, setState } from "./store.js";

let localStream = null;
let myChannel = null;
let muted = false;
let deafened = false;
let ctx = null;
let processor = null;
let sourceNode = null;
let outGain = null;
const playQueues = new Map();

function b64FromI16(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function i16FromB64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export function voiceStatus() {
  return { channelId: myChannel, muted, deafened, streaming: false };
}

async function ensureMic() {
  if (localStream) return localStream;
  const mic = localStorage.getItem("hearth.mic") || "";
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      ...(mic ? { deviceId: { exact: mic } } : {}),
    },
    video: false,
  });
  return localStream;
}

function ensureCtx() {
  if (ctx) return ctx;
  ctx = new AudioContext();
  outGain = ctx.createGain();
  outGain.gain.value = 1;
  outGain.connect(ctx.destination);
  return ctx;
}

function startCapture() {
  const ac = ensureCtx();
  if (processor) return;
  sourceNode = ac.createMediaStreamSource(localStream);
  processor = ac.createScriptProcessor(1024, 1, 1);
  const muteGain = ac.createGain();
  muteGain.gain.value = 0;
  processor.onaudioprocess = (e) => {
    if (!myChannel || muted || deafened) return;
    const input = e.inputBuffer.getChannelData(0);
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    sendWs({ type: "voice.frame", data: b64FromI16(pcm), rate: e.inputBuffer.sampleRate });
  };
  sourceNode.connect(processor);
  processor.connect(muteGain);
  muteGain.connect(ac.destination);
}

function stopCapture() {
  if (processor) {
    processor.disconnect();
    processor.onaudioprocess = null;
    processor = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
}

function playFrame(from, b64, rate) {
  if (deafened) return;
  const ac = ensureCtx();
  const pcm = i16FromB64(b64);
  if (!pcm.length) return;
  const sr = rate || 48000;
  const f32 = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 0x8000;
  const buf = ac.createBuffer(1, f32.length, sr);
  buf.getChannelData(0).set(f32);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(outGain);
  const nowt = ac.currentTime;
  const q = playQueues.get(from) || nowt;
  const start = Math.max(nowt, q);
  src.start(start);
  playQueues.set(from, start + buf.duration);
}

export function handleVoiceFrame(msg) {
  if (!myChannel || msg.type !== "voice.frame" || !msg.data) return;
  if (msg.from === getState().me?.id) return;
  playFrame(msg.from, msg.data, msg.rate);
}

export async function handleRtc() {
  /* P2P disabled — IPs are never exchanged. */
}

export async function joinVoice(channelId) {
  await ensureMic();
  await ensureCtx().resume();
  myChannel = channelId;
  muted = false;
  deafened = false;
  startCapture();
  sendWs({ type: "voice.join", channel_id: channelId, muted, deafened, streaming: false });
  setState({ voiceMe: { channelId, muted, deafened, streaming: false } });
}

export function onVoiceJoin() {
  /* no peer connections */
}

export function leaveVoice() {
  if (myChannel) sendWs({ type: "voice.leave" });
  stopCapture();
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  myChannel = null;
  playQueues.clear();
  setState({ voiceMe: null });
}

export function setMuted(next) {
  muted = next;
  sendWs({ type: "voice.state", muted, deafened, streaming: false });
  const s = getState();
  setState({ voiceMe: s.voiceMe ? { ...s.voiceMe, muted, deafened, streaming: false } : s.voiceMe });
}

export function setDeafened(next) {
  deafened = next;
  if (deafened) muted = true;
  sendWs({ type: "voice.state", muted, deafened, streaming: false });
  const s = getState();
  setState({ voiceMe: s.voiceMe ? { ...s.voiceMe, muted, deafened, streaming: false } : s.voiceMe });
}

export async function toggleScreen() {
  throw new Error("Screen share is off so your IP is never sent to other people.");
}
