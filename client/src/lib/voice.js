import { sendWs } from "./socket.js";
import { getState, setState } from "./store.js";

const peers = new Map();
let localStream = null;
let screenStream = null;
const remoteAudio = new Map();
let myChannel = null;
let muted = false;
let deafened = false;
let streaming = false;

const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

export function voiceStatus() {
  return { channelId: myChannel, muted, deafened, streaming };
}

async function ensureMic() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  localStream.getAudioTracks().forEach((t) => {
    t.enabled = !muted && !deafened;
  });
  return localStream;
}

function attachRemote(id, stream) {
  let el = remoteAudio.get(id);
  if (!el) {
    el = document.createElement("audio");
    el.autoplay = true;
    el.playsInline = true;
    document.body.appendChild(el);
    remoteAudio.set(id, el);
  }
  el.srcObject = stream;
  el.muted = deafened;
  el.play().catch(() => {});
}

function cleanupPeer(id) {
  const pc = peers.get(id);
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.close();
    peers.delete(id);
  }
  const el = remoteAudio.get(id);
  if (el) {
    el.srcObject = null;
    el.remove();
    remoteAudio.delete(id);
  }
}

async function makePeer(remoteId, initiator) {
  if (peers.has(remoteId)) return peers.get(remoteId);
  const pc = new RTCPeerConnection(ICE);
  peers.set(remoteId, pc);
  const stream = await ensureMic();
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  if (screenStream) {
    for (const track of screenStream.getTracks()) pc.addTrack(track, screenStream);
  }
  pc.onicecandidate = (e) => {
    if (e.candidate) sendWs({ type: "rtc", to: remoteId, data: { kind: "ice", candidate: e.candidate } });
  };
  pc.ontrack = (e) => {
    const [stream] = e.streams;
    if (stream) attachRemote(remoteId, stream);
  };
  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendWs({ type: "rtc", to: remoteId, data: { kind: "offer", sdp: pc.localDescription } });
  }
  return pc;
}

export async function handleRtc(msg) {
  if (msg.type !== "rtc" || !myChannel) return;
  const from = msg.from;
  const data = msg.data || {};
  try {
    if (data.kind === "offer") {
      const pc = await makePeer(from, false);
      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWs({ type: "rtc", to: from, data: { kind: "answer", sdp: pc.localDescription } });
    } else if (data.kind === "answer") {
      const pc = peers.get(from) || (await makePeer(from, false));
      await pc.setRemoteDescription(data.sdp);
    } else if (data.kind === "ice") {
      const pc = peers.get(from);
      if (pc && data.candidate) await pc.addIceCandidate(data.candidate);
    }
  } catch (err) {
    console.warn("rtc", err);
  }
}

export async function joinVoice(channelId) {
  await ensureMic();
  myChannel = channelId;
  muted = false;
  deafened = false;
  sendWs({ type: "voice.join", channel_id: channelId, muted, deafened, streaming });
  setState({ voiceMe: { channelId, muted, deafened, streaming } });
}

export function onVoiceJoin(msg, meId) {
  if (!myChannel || msg.channel_id !== myChannel) return;
  if (msg.user_id === meId) {
    const peersIds = msg.peers || [];
    for (const pid of peersIds) makePeer(pid, true);
    return;
  }
  makePeer(msg.user_id, true);
}

export function leaveVoice() {
  if (myChannel) sendWs({ type: "voice.leave" });
  for (const id of [...peers.keys()]) cleanupPeer(id);
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  myChannel = null;
  streaming = false;
  setState({ voiceMe: null });
}

export function setMuted(next) {
  muted = next;
  if (localStream) localStream.getAudioTracks().forEach((t) => (t.enabled = !muted && !deafened));
  sendWs({ type: "voice.state", muted, deafened, streaming });
  const s = getState();
  setState({ voiceMe: s.voiceMe ? { ...s.voiceMe, muted, deafened, streaming } : s.voiceMe });
}

export function setDeafened(next) {
  deafened = next;
  if (deafened) muted = true;
  if (localStream) localStream.getAudioTracks().forEach((t) => (t.enabled = !muted && !deafened));
  for (const el of remoteAudio.values()) el.muted = deafened;
  sendWs({ type: "voice.state", muted, deafened, streaming });
  const s = getState();
  setState({ voiceMe: s.voiceMe ? { ...s.voiceMe, muted, deafened, streaming } : s.voiceMe });
}

export async function toggleScreen() {
  if (streaming && screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    streaming = false;
    sendWs({ type: "voice.state", muted, deafened, streaming });
    const s = getState();
    setState({ voiceMe: s.voiceMe ? { ...s.voiceMe, streaming } : s.voiceMe });
    return;
  }
  screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  streaming = true;
  for (const pc of peers.values()) {
    for (const track of screenStream.getTracks()) pc.addTrack(track, screenStream);
  }
  screenStream.getVideoTracks()[0].addEventListener("ended", () => {
    streaming = false;
    screenStream = null;
    sendWs({ type: "voice.state", muted, deafened, streaming: false });
    const s = getState();
    setState({ voiceMe: s.voiceMe ? { ...s.voiceMe, streaming: false } : s.voiceMe });
  });
  sendWs({ type: "voice.state", muted, deafened, streaming });
  const s = getState();
  setState({ voiceMe: s.voiceMe ? { ...s.voiceMe, streaming } : s.voiceMe });
}
