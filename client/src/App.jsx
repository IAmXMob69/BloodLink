import React, { useEffect } from "react";
import { api, getToken, setToken } from "./lib/api.js";
import { getState, setState, useStore } from "./lib/store.js";
import { connect, disconnect, onSocket } from "./lib/socket.js";
import {
  joinVoice,
  leaveVoice,
  handleRtc,
  onVoiceJoin,
  setMuted,
  setDeafened,
  toggleScreen,
} from "./lib/voice.js";
import { displayName, tagName, initials } from "./lib/format.jsx";
import Auth from "./components/Auth.jsx";
import Avatar from "./components/Avatar.jsx";
import Chat from "./components/Chat.jsx";
import { Ico } from "./components/Icons.jsx";
import {
  CreateServer,
  JoinServer,
  InviteModal,
  CreateChannel,
  Settings,
  ProfilePop,
  ContextMenu,
} from "./components/Modals.jsx";

export default function App() {
  const me = useStore((s) => s.me);
  const token = useStore((s) => s.token);

  useEffect(() => {
    const t = getToken();
    if (!t) return;
    setState({ token: t });
    connect();
    return () => disconnect();
  }, []);

  useEffect(() => {
    return onSocket((msg) => {
      const s = getState();
      if (msg.type === "rtc") handleRtc(msg);
      if (msg.type === "voice.join") onVoiceJoin(msg, s.me?.id);
      if (msg.type === "voice.leave" && msg.user_id === s.me?.id) {
        /* remote drop handled in voice.js */
      }
    });
  }, []);

  useEffect(() => {
    function close(e) {
      if (e.key === "Escape") {
        setState({ contextMenu: null, popout: null, settingsOpen: false, modal: null });
      }
    }
    function click() {
      setState({ contextMenu: null, popout: null });
    }
    window.addEventListener("keydown", close);
    window.addEventListener("click", click);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("click", click);
    };
  }, []);

  if (!getToken() && !token) return <Auth onAuthed={(d) => { setState({ token: d.token, me: d.user }); connect(); }} />;
  if (!me) {
    return (
      <div className="auth">
        <div className="muted">Connecting to Hearth…</div>
      </div>
    );
  }
  return <Shell />;
}

function Shell() {
  const servers = useStore((s) => s.servers);
  const dms = useStore((s) => s.dms);
  const active = useStore((s) => s.active);
  const me = useStore((s) => s.me);
  const modal = useStore((s) => s.modal);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const contextMenu = useStore((s) => s.contextMenu);
  const popout = useStore((s) => s.popout);
  const membersOpen = useStore((s) => s.membersOpen);
  const voiceMe = useStore((s) => s.voiceMe);
  const voiceStates = useStore((s) => s.voiceStates);

  const server = servers.find((s) => s.id === active.serverId) || null;
  const channel =
    (server?.channels || []).find((c) => c.id === active.channelId) ||
    dms.find((c) => c.id === active.channelId) ||
    null;

  return (
    <div className="app">
      <ServerRail servers={servers} active={active} />
      {active.kind === "friends" || !server ? (
        <HomeSidebar dms={dms} active={active} me={me} voiceMe={voiceMe} />
      ) : (
        <ServerSidebar server={server} active={active} voiceStates={voiceStates} voiceMe={voiceMe} me={me} />
      )}
      {active.kind === "friends" && !channel ? (
        <FriendsView />
      ) : channel && channel.type !== "voice" ? (
        <Chat channel={channel} me={me} />
      ) : (
        <VoiceSplash channel={channel} server={server} />
      )}
      {membersOpen && server && <MemberList server={server} me={me} />}

      {modal?.type === "create-server" && <CreateServer />}
      {modal?.type === "join" && <JoinServer />}
      {modal?.type === "invite" && server && <InviteModal server={server} />}
      {modal?.type === "create-channel" && server && (
        <CreateChannel server={server} type={modal.channelType || "text"} />
      )}
      {settingsOpen && <Settings me={me} />}
      {contextMenu && <ContextMenu {...contextMenu} />}
      {popout && (
        <div onClick={(e) => e.stopPropagation()}>
          <ProfilePop
            user={popout.user}
            x={popout.x}
            y={popout.y}
            me={me}
            onMessage={() => openDm(popout.user.id)}
            onFriend={() => addFriendUser(popout.user)}
            onKick={
              server?.is_owner && popout.user.id !== me.id
                ? () => {
                    api(`/api/servers/${server.id}/kick/${popout.user.id}`, { method: "POST", body: {} });
                    setState({ popout: null });
                  }
                : null
            }
          />
        </div>
      )}
    </div>
  );
}

function ServerRail({ servers, active }) {
  return (
    <nav className="rail">
      <div className="pill-wrap">
        <span className={`pill ${active.kind === "friends" ? "active" : ""}`} />
        <button
          className={`srv home ${active.kind === "friends" ? "on" : ""}`}
          title="Direct Messages"
          onClick={() => setState({ active: { kind: "friends", serverId: null, channelId: null, tab: "online" } })}
        >
          {Ico.home}
        </button>
      </div>
      <div className="rail-sep" />
      {servers.map((s) => (
        <div key={s.id} className="pill-wrap">
          <span className={`pill ${active.serverId === s.id ? "active" : ""}`} />
          <button
            className={`srv ${active.serverId === s.id ? "on" : ""}`}
            title={s.name}
            onClick={() => {
              const first = (s.channels || []).find((c) => c.type === "text");
              setState({
                active: { kind: "server", serverId: s.id, channelId: first?.id || null, tab: "online" },
              });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setState({
                contextMenu: {
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    {
                      label: "Invite people",
                      onClick: () => setState({ modal: { type: "invite" }, contextMenu: null, active: { ...getState().active, serverId: s.id, kind: "server" } }),
                    },
                    {
                      label: "Server settings",
                      onClick: () => setState({ settingsOpen: true, contextMenu: null }),
                    },
                    "-",
                    {
                      label: s.is_owner ? "Delete server" : "Leave server",
                      danger: true,
                      onClick: () => {
                        if (s.is_owner) api(`/api/servers/${s.id}`, { method: "DELETE" });
                        else api(`/api/servers/${s.id}/leave`, { method: "POST", body: {} });
                        setState({ contextMenu: null });
                      },
                    },
                  ],
                },
              });
            }}
          >
            {s.icon ? <img src={s.icon} alt="" /> : initials(s.name)}
          </button>
        </div>
      ))}
      <button className="srv add" title="Add a Server" onClick={() => setState({ modal: { type: "create-server" } })}>
        +
      </button>
    </nav>
  );
}

function HomeSidebar({ dms, active, me, voiceMe }) {
  return (
    <aside className="sidebar">
      <div className="side-head" onClick={() => setState({ active: { ...active, kind: "friends", channelId: null } })}>
        Friends
      </div>
      <div className="side-scroll">
        <div className="cat">Direct messages</div>
        {dms.map((d) => {
          const u = d.recipients?.[0];
          return (
            <div
              key={d.id}
              className={`ch dm-item ${active.channelId === d.id ? "on" : ""}`}
              onClick={() => setState({ active: { kind: "friends", serverId: null, channelId: d.id, tab: "online" } })}
            >
              <Avatar user={u} size="sm" />
              <div className="name">{displayName(u)}</div>
            </div>
          );
        })}
        {!dms.length && <div className="muted" style={{ padding: 8, fontSize: 13 }}>No conversations yet.</div>}
      </div>
      {voiceMe && <VoicePanel />}
      <UserBar me={me} voiceMe={voiceMe} />
    </aside>
  );
}

function ServerSidebar({ server, active, voiceStates, voiceMe, me }) {
  const cats = (server.channels || []).filter((c) => c.type === "category");
  const rest = (server.channels || []).filter((c) => c.type !== "category");
  const collapsed = useStore((s) => s.collapsedCats);
  const grouped = [];
  if (cats.length) {
    for (const cat of cats) {
      grouped.push({ cat, children: rest.filter((c) => c.parent_id === cat.id) });
    }
    const orphans = rest.filter((c) => !c.parent_id || !cats.some((x) => x.id === c.parent_id));
    if (orphans.length) grouped.unshift({ cat: null, children: orphans });
  } else {
    grouped.push({ cat: null, children: rest });
  }

  return (
    <aside className="sidebar">
      <div
        className="side-head"
        onClick={(e) => {
          e.stopPropagation();
          setState({
            contextMenu: {
              x: e.clientX,
              y: 48,
              items: [
                { label: "Invite people", onClick: () => setState({ modal: { type: "invite" }, contextMenu: null }) },
                { label: "Create channel", onClick: () => setState({ modal: { type: "create-channel" }, contextMenu: null }) },
                "-",
                server.is_owner
                  ? {
                      label: "Delete server",
                      danger: true,
                      onClick: () => {
                        if (confirm(`Delete ${server.name}?`)) api(`/api/servers/${server.id}`, { method: "DELETE" });
                        setState({ contextMenu: null });
                      },
                    }
                  : {
                      label: "Leave server",
                      danger: true,
                      onClick: () => {
                        api(`/api/servers/${server.id}/leave`, { method: "POST", body: {} });
                        setState({ contextMenu: null });
                      },
                    },
              ],
            },
          });
        }}
      >
        <span>{server.name}</span>
        <span>▾</span>
      </div>
      <div className="side-scroll">
        {grouped.map(({ cat, children }) => (
          <div key={cat?.id || "root"}>
            {cat && (
              <div
                className="cat"
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    collapsedCats: { ...s.collapsedCats, [cat.id]: !s.collapsedCats[cat.id] },
                  }))
                }
              >
                <span>{collapsed[cat.id] ? "▸" : "▾"}</span>
                {cat.name}
                {server.is_owner && (
                  <span
                    className="plus"
                    onClick={(e) => {
                      e.stopPropagation();
                      setState({ modal: { type: "create-channel" } });
                    }}
                  >
                    +
                  </span>
                )}
              </div>
            )}
            {!cat || !collapsed[cat.id]
              ? children.map((c) => (
                  <div key={c.id}>
                    <div
                      className={`ch ${active.channelId === c.id ? "on" : ""}`}
                      onClick={() => {
                        if (c.type === "voice") {
                          joinVoice(c.id).catch((err) => alert(err.message));
                          setState({ active: { ...active, channelId: c.id } });
                        } else {
                          setState({ active: { ...active, channelId: c.id } });
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const items = [
                          {
                            label: "Edit channel",
                            onClick: () => {
                              const name = prompt("Channel name", c.name);
                              if (name) api(`/api/channels/${c.id}`, { method: "PATCH", body: { name } });
                              setState({ contextMenu: null });
                            },
                          },
                          {
                            label: "Delete channel",
                            danger: true,
                            onClick: () => {
                              api(`/api/channels/${c.id}`, { method: "DELETE" });
                              setState({ contextMenu: null });
                            },
                          },
                        ];
                        setState({ contextMenu: { x: e.clientX, y: e.clientY, items } });
                      }}
                    >
                      <span className="hash">{c.type === "voice" ? Ico.speaker : Ico.hash}</span>
                      <span className="name">{c.name}</span>
                    </div>
                    {c.type === "voice" &&
                      Object.values(voiceStates)
                        .filter((v) => v.channel_id === c.id)
                        .map((v) => {
                          const u = (server.members || []).find((m) => m.id === v.user_id);
                          return (
                            <div key={v.user_id} className="voice-user">
                              <Avatar user={u} size="xs" />
                              <span>{displayName(u)}</span>
                              {v.muted && <span title="Muted">{Ico.micOff}</span>}
                              {v.deafened && <span title="Deafened">{Ico.phonesOff}</span>}
                            </div>
                          );
                        })}
                  </div>
                ))
              : null}
          </div>
        ))}
      </div>
      {voiceMe && <VoicePanel />}
      <UserBar me={me} voiceMe={voiceMe} />
    </aside>
  );
}

function VoicePanel() {
  const voiceMe = useStore((s) => s.voiceMe);
  const servers = useStore((s) => s.servers);
  let ch = null;
  let srv = null;
  for (const s of servers) {
    const c = (s.channels || []).find((x) => x.id === voiceMe.channelId);
    if (c) {
      ch = c;
      srv = s;
      break;
    }
  }
  return (
    <div className="voicebar">
      <div className="row">
        <div>
          <div className="strong">Voice connected</div>
          <div className="muted">
            {ch?.name} / {srv?.name}
          </div>
        </div>
        <div className="btns">
          <button className="icon-btn" title="Share screen" onClick={() => toggleScreen().catch((e) => alert(e.message))}>
            {Ico.screen}
          </button>
          <button className="icon-btn" title="Disconnect" onClick={() => leaveVoice()}>
            {Ico.leave}
          </button>
        </div>
      </div>
    </div>
  );
}

function UserBar({ me, voiceMe }) {
  return (
    <div className="userbar">
      <div
        onClick={(e) => {
          e.stopPropagation();
          setState({ popout: { user: me, x: e.clientX, y: e.clientY - 200 } });
        }}
      >
        <Avatar user={me} size="sm" />
      </div>
      <div className="meta">
        <div className="name">{displayName(me)}</div>
        <div className="sub">{me.custom_status || tagName(me)}</div>
      </div>
      <button
        className={`icon-btn ${voiceMe?.muted ? "on" : ""}`}
        title="Mute"
        onClick={() => setMuted(!(voiceMe?.muted))}
      >
        {voiceMe?.muted ? Ico.micOff : Ico.mic}
      </button>
      <button
        className={`icon-btn ${voiceMe?.deafened ? "on" : ""}`}
        title="Deafen"
        onClick={() => setDeafened(!(voiceMe?.deafened))}
      >
        {voiceMe?.deafened ? Ico.phonesOff : Ico.phones}
      </button>
      <button className="icon-btn" title="User settings" onClick={() => setState({ settingsOpen: true })}>
        {Ico.gear}
      </button>
    </div>
  );
}

function MemberList({ server, me }) {
  const members = server.members || [];
  const online = members.filter((m) => m.status && m.status !== "offline" && m.status !== "invisible");
  const offline = members.filter((m) => !m.status || m.status === "offline" || m.status === "invisible");
  function open(e, user) {
    e.stopPropagation();
    setState({ popout: { user, x: e.clientX - 310, y: e.clientY } });
  }
  return (
    <aside className="members">
      <h4>Online — {online.length}</h4>
      {online.map((m) => (
        <div key={m.id} className="member" onClick={(e) => open(e, m)}>
          <Avatar user={m} size="sm" />
          <div>
            <div className="nm" style={{ color: m.avatar_color }}>
              {m.nickname || displayName(m)}
            </div>
            {m.custom_status && <div className="cst">{m.custom_status}</div>}
          </div>
        </div>
      ))}
      <h4 style={{ marginTop: 16 }}>Offline — {offline.length}</h4>
      {offline.map((m) => (
        <div key={m.id} className="member" onClick={(e) => open(e, m)} style={{ opacity: 0.5 }}>
          <Avatar user={m} size="sm" status="offline" />
          <div className="nm">{m.nickname || displayName(m)}</div>
        </div>
      ))}
    </aside>
  );
}

function FriendsView() {
  const tab = useStore((s) => s.active.tab || "online");
  const friends = useStore((s) => s.friends);
  const pending = useStore((s) => s.pending);
  const me = useStore((s) => s.me);
  const [query, setQuery] = React.useState("");
  const [msg, setMsg] = React.useState("");

  const online = friends.filter((f) => f.user?.status && f.user.status !== "offline" && f.user.status !== "invisible");
  const list = tab === "online" ? online : tab === "all" ? friends : tab === "pending" ? pending : friends;

  async function add(e) {
    e.preventDefault();
    setMsg("");
    try {
      await api("/api/friends", { method: "POST", body: { username: query } });
      setMsg("Friend request sent.");
      setQuery("");
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <div className="friends-page">
      <div className="topbar">
        <strong>Friends</strong>
        <div className="friends-tabs">
          {[
            ["online", "Online"],
            ["all", "All"],
            ["pending", `Pending${pending.length ? ` (${pending.length})` : ""}`],
            ["add", "Add Friend"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={`tab ${id === "add" ? "add" : ""} ${tab === id ? "on" : ""}`}
              onClick={() => setState((s) => ({ ...s, active: { ...s.active, tab: id } }))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "add" ? (
        <div style={{ padding: 24, maxWidth: 560 }}>
          <h3 style={{ marginTop: 0 }}>Add friend</h3>
          <p className="muted">You can add friends with their Hearth tag. It's cAsE sEnSiTiVe!</p>
          <form onSubmit={add} style={{ display: "flex", gap: 8 }}>
            <input
              className="field"
              style={{ flex: 1, background: "var(--bg-tertiary)", border: 0, color: "var(--text-strong)", padding: 12, borderRadius: 8 }}
              placeholder="Username#0000"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="btn" type="submit">
              Send request
            </button>
          </form>
          {msg && <p>{msg}</p>}
          <p className="muted">Your tag is {tagName(me)}</p>
        </div>
      ) : (
        <div className="friends-list">
          <div className="muted" style={{ padding: "8px 8px 4px", fontSize: 12, fontWeight: 700, letterSpacing: 0.4 }}>
            {tab.toUpperCase()} — {list.length}
          </div>
          {list.map((f) => (
            <div key={f.id} className="friend-row">
              <Avatar user={f.user} size="sm" />
              <div className="grow">
                <div className="strong">{displayName(f.user)}</div>
                <div className="muted">{tagName(f.user)}</div>
              </div>
              {tab === "pending" && f.requested_by !== me.id && (
                <button className="btn sm" onClick={() => api(`/api/friends/${f.id}`, { method: "PUT" })}>
                  Accept
                </button>
              )}
              {tab !== "pending" && (
                <button className="icon-btn" title="Message" onClick={() => openDm(f.user.id)}>
                  {Ico.hash}
                </button>
              )}
              <button className="icon-btn" title="Remove" onClick={() => api(`/api/friends/${f.id}`, { method: "DELETE" })}>
                ✕
              </button>
            </div>
          ))}
          {!list.length && <div className="empty">No one's around. Add a friend to get started.</div>}
        </div>
      )}
    </div>
  );
}

function VoiceSplash({ channel, server }) {
  if (!channel) {
    return (
      <div className="main">
        <div className="empty">Select a channel to start talking.</div>
      </div>
    );
  }
  return (
    <div className="main">
      <div className="topbar">
        <span className="hash">{Ico.speaker}</span>
        <h2>{channel.name}</h2>
      </div>
      <div className="empty">
        <div className="big-hash" style={{ margin: "0 auto 12px" }}>
          {Ico.speaker}
        </div>
        <h3>{channel.name}</h3>
        <p>Voice channel in {server?.name}. Use the control bar to mute, deafen, or share your screen.</p>
        <button className="btn" onClick={() => joinVoice(channel.id).catch((e) => alert(e.message))}>
          Join Voice
        </button>
      </div>
    </div>
  );
}

async function openDm(userId) {
  const data = await api("/api/dms", { method: "POST", body: { user_id: userId } });
  setState({
    popout: null,
    active: { kind: "friends", serverId: null, channelId: data.channel.id, tab: "online" },
  });
}

async function addFriendUser(user) {
  try {
    await api("/api/friends", { method: "POST", body: { username: `${user.username}#${user.tag}` } });
    setState({ popout: null });
  } catch (e) {
    alert(e.message);
  }
}
