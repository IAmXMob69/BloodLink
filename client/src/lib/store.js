import { useSyncExternalStore } from "react";

const listeners = new Set();

const initial = {
  token: "",
  me: null,
  servers: [],
  dms: [],
  friends: [],
  pending: [],
  reads: {},
  voiceStates: {},
  messages: {},
  typing: {},
  active: { kind: "friends", serverId: null, channelId: null, tab: "online" },
  connected: false,
  connecting: false,
  error: "",
  settingsOpen: false,
  settingsTab: "account",
  modal: null,
  contextMenu: null,
  popout: null,
  search: "",
  searchResults: null,
  collapsedCats: {},
  membersOpen: true,
  sourceUrl: "https://github.com/hearth-chat/hearth",
};

let state = { ...initial };

export function getState() {
  return state;
}

export function setState(patch) {
  state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
  for (const l of listeners) l();
}

export function useStore(selector = (s) => s) {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
    () => selector(state)
  );
}

export function resetStore() {
  state = { ...initial, active: { ...initial.active } };
  for (const l of listeners) l();
}

export function upsertServer(server) {
  setState((s) => {
    const i = s.servers.findIndex((x) => x.id === server.id);
    const servers = [...s.servers];
    if (i >= 0) servers[i] = { ...servers[i], ...server };
    else servers.push(server);
    return { ...s, servers };
  });
}

export function applyEvent(msg) {
  switch (msg.type) {
    case "ready":
      setState((s) => ({
        ...s,
        me: msg.user,
        servers: msg.servers || [],
        dms: msg.dms || [],
        friends: msg.friends || [],
        pending: msg.pending || [],
        reads: msg.reads || {},
        voiceStates: Object.fromEntries((msg.voice_states || []).map((v) => [v.user_id, v])),
        connected: true,
        connecting: false,
        sourceUrl: msg.source_url || s.sourceUrl,
      }));
      break;
    case "user.update":
      setState((s) => ({ ...s, me: { ...s.me, ...msg.user } }));
      break;
    case "server.create":
    case "server.update":
      upsertServer(msg.server);
      break;
    case "server.delete":
      setState((s) => ({
        ...s,
        servers: s.servers.filter((x) => x.id !== msg.server_id),
        active:
          s.active.serverId === msg.server_id
            ? { kind: "friends", serverId: null, channelId: null, tab: "online" }
            : s.active,
      }));
      break;
    case "channel.create":
      setState((s) => ({
        ...s,
        servers: s.servers.map((sv) =>
          sv.id === msg.channel.server_id
            ? { ...sv, channels: [...(sv.channels || []), msg.channel] }
            : sv
        ),
      }));
      break;
    case "channel.update":
      setState((s) => ({
        ...s,
        servers: s.servers.map((sv) =>
          sv.id === msg.channel.server_id
            ? {
                ...sv,
                channels: (sv.channels || []).map((c) => (c.id === msg.channel.id ? msg.channel : c)),
              }
            : sv
        ),
      }));
      break;
    case "channel.delete":
      setState((s) => ({
        ...s,
        servers: s.servers.map((sv) =>
          sv.id === msg.server_id
            ? { ...sv, channels: (sv.channels || []).filter((c) => c.id !== msg.channel_id) }
            : sv
        ),
        active:
          s.active.channelId === msg.channel_id
            ? { ...s.active, channelId: null }
            : s.active,
      }));
      break;
    case "member.add":
      setState((s) => ({
        ...s,
        servers: s.servers.map((sv) =>
          sv.id === msg.server_id ? { ...sv, members: [...(sv.members || []), msg.member] } : sv
        ),
      }));
      break;
    case "member.remove":
      setState((s) => ({
        ...s,
        servers: s.servers.map((sv) =>
          sv.id === msg.server_id
            ? { ...sv, members: (sv.members || []).filter((m) => m.id !== msg.user_id) }
            : sv
        ),
      }));
      break;
    case "presence":
      setState((s) => ({
        ...s,
        servers: s.servers.map((sv) => ({
          ...sv,
          members: (sv.members || []).map((m) => (m.id === msg.user.id ? { ...m, ...msg.user } : m)),
        })),
        dms: s.dms.map((d) => ({
          ...d,
          recipients: (d.recipients || []).map((u) => (u.id === msg.user.id ? { ...u, ...msg.user } : u)),
        })),
        friends: s.friends.map((f) =>
          f.user?.id === msg.user.id ? { ...f, user: { ...f.user, ...msg.user } } : f
        ),
      }));
      break;
    case "message.create":
      setState((s) => {
        const list = s.messages[msg.message.channel_id] || [];
        if (list.some((m) => m.id === msg.message.id)) return s;
        return {
          ...s,
          messages: { ...s.messages, [msg.message.channel_id]: [...list, msg.message] },
        };
      });
      break;
    case "message.update":
      setState((s) => {
        const list = s.messages[msg.message.channel_id] || [];
        return {
          ...s,
          messages: {
            ...s.messages,
            [msg.message.channel_id]: list.map((m) => (m.id === msg.message.id ? msg.message : m)),
          },
        };
      });
      break;
    case "message.delete":
      setState((s) => {
        const list = s.messages[msg.channel_id] || [];
        return {
          ...s,
          messages: {
            ...s.messages,
            [msg.channel_id]: list.filter((m) => m.id !== msg.message_id),
          },
        };
      });
      break;
    case "message.react":
      setState((s) => {
        const list = s.messages[msg.channel_id] || [];
        return {
          ...s,
          messages: {
            ...s.messages,
            [msg.channel_id]: list.map((m) =>
              m.id === msg.message_id ? { ...m, reactions: msg.reactions } : m
            ),
          },
        };
      });
      break;
    case "typing":
      setState((s) => {
        const arr = (s.typing[msg.channel_id] || []).filter((u) => u.id !== msg.user.id);
        return { ...s, typing: { ...s.typing, [msg.channel_id]: [...arr, { ...msg.user, at: Date.now() }] } };
      });
      setTimeout(() => {
        setState((s) => {
          const arr = (s.typing[msg.channel_id] || []).filter(
            (u) => u.id !== msg.user.id || Date.now() - u.at < 8000
          );
          return { ...s, typing: { ...s.typing, [msg.channel_id]: arr.filter((u) => Date.now() - u.at < 8500) } };
        });
      }, 8500);
      break;
    case "friend.update":
      setState((s) => {
        if (msg.friend.status === "accepted") {
          return {
            ...s,
            friends: [...s.friends.filter((f) => f.id !== msg.friend.id), msg.friend],
            pending: s.pending.filter((f) => f.id !== msg.friend.id),
          };
        }
        return {
          ...s,
          pending: [...s.pending.filter((f) => f.id !== msg.friend.id), msg.friend],
        };
      });
      break;
    case "friend.remove":
      setState((s) => ({
        ...s,
        friends: s.friends.filter((f) => f.id !== msg.id),
        pending: s.pending.filter((f) => f.id !== msg.id),
      }));
      break;
    case "dm.create":
      setState((s) => {
        if (s.dms.some((d) => d.id === msg.channel.id)) {
          return { ...s, dms: s.dms.map((d) => (d.id === msg.channel.id ? msg.channel : d)) };
        }
        return { ...s, dms: [msg.channel, ...s.dms] };
      });
      break;
    case "voice.join":
      setState((s) => ({
        ...s,
        voiceStates: {
          ...s.voiceStates,
          [msg.user_id]: {
            user_id: msg.user_id,
            channel_id: msg.channel_id,
            muted: msg.muted,
            deafened: msg.deafened,
            streaming: msg.streaming,
          },
        },
      }));
      break;
    case "voice.state":
      setState((s) => ({
        ...s,
        voiceStates: {
          ...s.voiceStates,
          [msg.user_id]: { ...(s.voiceStates[msg.user_id] || {}), ...msg },
        },
      }));
      break;
    case "voice.leave":
      setState((s) => {
        const next = { ...s.voiceStates };
        delete next[msg.user_id];
        return { ...s, voiceStates: next };
      });
      break;
    default:
      break;
  }
}

export function unreadCount(channelId) {
  const s = state;
  const list = s.messages[channelId] || [];
  const last = s.reads[channelId];
  if (!list.length) return 0;
  if (!last) return list.length;
  const idx = list.findIndex((m) => m.id === last);
  if (idx < 0) return list.length;
  return Math.max(0, list.length - idx - 1);
}
