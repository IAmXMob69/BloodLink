import React, { useEffect, useRef, useState } from "react";
import { api, assetUrl, uploadFile } from "../lib/api.js";
import { getState, setState, useStore } from "../lib/store.js";
import { sendWs } from "../lib/socket.js";
import { Md, displayName, timeLabel, shortTime, shouldGroup, EMOJIS } from "../lib/format.jsx";
import Avatar from "./Avatar.jsx";
import { Ico } from "./Icons.jsx";

export default function Chat({ channel, me }) {
  const messages = useStore((s) => s.messages[channel.id] || []);
  const typing = useStore((s) => s.typing[channel.id] || []);
  const [text, setText] = useState("");
  const [reply, setReply] = useState(null);
  const [editId, setEditId] = useState(null);
  const [emojiFor, setEmojiFor] = useState(null);
  const [picker, setPicker] = useState(false);
  const box = useRef(null);
  const ta = useRef(null);
  const loaded = useRef("");

  useEffect(() => {
    if (loaded.current === channel.id) return;
    loaded.current = channel.id;
    api(`/api/channels/${channel.id}/messages?limit=50`)
      .then((d) => {
        setState((s) => ({
          ...s,
          messages: { ...s.messages, [channel.id]: d.messages || [] },
        }));
        const last = d.messages?.[d.messages.length - 1];
        if (last) {
          api("/api/read", { method: "POST", body: { channel_id: channel.id, last_read: last.id } });
          setState((s) => ({ ...s, reads: { ...s.reads, [channel.id]: last.id } }));
        }
        requestAnimationFrame(() => {
          if (box.current) box.current.scrollTop = box.current.scrollHeight;
        });
      })
      .catch(() => {});
  }, [channel.id]);

  useEffect(() => {
    if (!box.current) return;
    const el = box.current;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      setReply(null);
      setEditId(null);
    }
    if (e.key === "ArrowUp" && !text && messages.length) {
      const mine = [...messages].reverse().find((m) => m.author?.id === me.id && !m.system);
      if (mine) {
        setEditId(mine.id);
        setText(mine.content);
      }
    }
  }

  async function submit() {
    const content = text;
    if (!content.trim() && !editId) return;
    setText("");
    if (ta.current) ta.current.style.height = "auto";
    try {
      if (editId) {
        await api(`/api/messages/${editId}`, { method: "PATCH", body: { content } });
        setEditId(null);
      } else {
        await api(`/api/channels/${channel.id}/messages`, {
          method: "POST",
          body: { content, reply_to: reply?.id || null },
        });
        setReply(null);
      }
    } catch (err) {
      setText(content);
      alert(err.message);
    }
  }

  let lastType = 0;
  function onChange(e) {
    setText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(200, e.target.scrollHeight) + "px";
    if (Date.now() - lastType > 1500) {
      lastType = Date.now();
      sendWs({ type: "typing", channel_id: channel.id });
    }
  }

  async function onFiles(files) {
    const atts = [];
    for (const f of files) {
      const up = await uploadFile(f);
      atts.push(up);
    }
    if (atts.length) {
      await api(`/api/channels/${channel.id}/messages`, {
        method: "POST",
        body: { content: text, attachments: atts, reply_to: reply?.id || null },
      });
      setText("");
      setReply(null);
    }
  }

  const others = typing.filter((u) => u.id !== me.id);
  const replyMap = Object.fromEntries(messages.map((m) => [m.id, m]));

  return (
    <div className="main">
      <div className="topbar">
        <span className="hash">{channel.type === "voice" ? Ico.speaker : Ico.hash}</span>
        <h2>{channel.name}</h2>
        {channel.topic && <span className="topic">{channel.topic}</span>}
        <span className="grow" />
        <Search channel={channel} />
        <button
          className="icon-btn"
          title="Member list"
          onClick={() => setState((s) => ({ ...s, membersOpen: !s.membersOpen }))}
        >
          {Ico.users}
        </button>
      </div>
      <div className="messages" ref={box}>
        <div className="welcome">
          <div className="big-hash">{channel.type === "voice" ? Ico.speaker : Ico.hash}</div>
          <h3>Welcome to #{channel.name}!</h3>
          <p>This is the start of the #{channel.name} channel. {channel.topic}</p>
        </div>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped = shouldGroup(prev, m);
          const replyTo = m.reply_to ? replyMap[m.reply_to] : null;
          return (
            <div
              key={m.id}
              className={`msg ${grouped ? "grouped" : "head"} ${
                m.content?.includes(`<@${me.id}>`) ? "mention-me" : ""
              }`}
              onContextMenu={(e) => {
                e.preventDefault();
                setState({
                  contextMenu: {
                    x: e.clientX,
                    y: e.clientY,
                    items: messageMenu(m, me, { setReply, setEditId, setText }),
                  },
                });
              }}
            >
              {!grouped && m.author && (
                <div
                  className="av"
                  onClick={(e) =>
                    setState({ popout: { user: m.author, x: e.clientX, y: e.clientY } })
                  }
                >
                  <Avatar user={m.author} />
                </div>
              )}
              {grouped && <span className="hover-when">{shortTime(m.created_at)}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                {!grouped && (
                  <div className="who">
                    <span
                      className="uname"
                      style={{ color: m.author?.avatar_color }}
                      onClick={(e) =>
                        setState({ popout: { user: m.author, x: e.clientX, y: e.clientY } })
                      }
                    >
                      {m.system ? "Hearth" : displayName(m.author)}
                    </span>
                    <span className="when">{timeLabel(m.created_at)}</span>
                    {m.edited_at && <span className="edit-tag">(edited)</span>}
                  </div>
                )}
                {replyTo && (
                  <div className="reply-ref">
                    {displayName(replyTo.author)}: {replyTo.content?.slice(0, 80)}
                  </div>
                )}
                <div className="body">
                  <Md text={m.content} />
                </div>
                {!!m.attachments?.length && (
                  <div className="attachments">
                    {m.attachments.map((a) =>
                      /\.(png|jpe?g|gif|webp)$/i.test(a.url || a.filename || "") ? (
                        <img key={a.url} src={assetUrl(a.url)} alt={a.filename} />
                      ) : (
                        <a key={a.url} className="file-chip" href={assetUrl(a.url)} target="_blank" rel="noreferrer">
                          {a.filename || "file"}
                        </a>
                      )
                    )}
                  </div>
                )}
                {!!m.reactions?.length && (
                  <div className="reacts">
                    {m.reactions.map((r) => (
                      <button
                        key={r.emoji}
                        className={`react ${r.users?.includes(me.id) ? "mine" : ""}`}
                        onClick={() =>
                          api(
                            `/api/messages/${m.id}/reactions/${encodeURIComponent(r.emoji)}`,
                            { method: r.users?.includes(me.id) ? "DELETE" : "PUT" }
                          )
                        }
                      >
                        {r.emoji} {r.count}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="msg-actions">
                <button title="Add reaction" onClick={() => setEmojiFor(emojiFor === m.id ? null : m.id)}>
                  {Ico.smile}
                </button>
                <button title="Reply" onClick={() => setReply(m)}>
                  {Ico.reply}
                </button>
                <button
                  title="More"
                  onClick={(e) =>
                    setState({
                      contextMenu: {
                        x: e.clientX,
                        y: e.clientY,
                        items: messageMenu(m, me, { setReply, setEditId, setText }),
                      },
                    })
                  }
                >
                  {Ico.dots}
                </button>
              </div>
              {emojiFor === m.id && (
                <div className="emoji-pop">
                  {EMOJIS.map((em) => (
                    <button
                      key={em}
                      onClick={() => {
                        api(`/api/messages/${m.id}/reactions/${encodeURIComponent(em)}`, { method: "PUT" });
                        setEmojiFor(null);
                      }}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {reply && (
        <div className="reply-bar">
          <span>
            Replying to <b>{displayName(reply.author)}</b>
          </span>
          <button className="btn ghost" onClick={() => setReply(null)}>
            ✕
          </button>
        </div>
      )}
      <div className="composer">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="icon-btn" title="Upload">
            {Ico.plus}
            <input
              type="file"
              hidden
              multiple
              onChange={(e) => {
                onFiles([...e.target.files]);
                e.target.value = "";
              }}
            />
          </label>
          <textarea
            ref={ta}
            rows={1}
            placeholder={editId ? "Edit message" : `Message #${channel.name}`}
            value={text}
            onChange={onChange}
            onKeyDown={onKey}
            onPaste={(e) => {
              const files = [...(e.clipboardData?.files || [])];
              if (files.length) {
                e.preventDefault();
                onFiles(files);
              }
            }}
          />
          <button type="button" className="icon-btn" onClick={() => setPicker((v) => !v)}>
            {Ico.smile}
          </button>
        </form>
        {picker && (
          <div className="emoji-pop">
            {EMOJIS.map((em) => (
              <button
                key={em}
                onClick={() => {
                  setText((t) => t + em);
                  setPicker(false);
                  ta.current?.focus();
                }}
              >
                {em}
              </button>
            ))}
          </div>
        )}
        {!!others.length && (
          <div className="typing">
            <b>{others.map((u) => displayName(u)).join(", ")}</b>{" "}
            {others.length === 1 ? "is" : "are"} typing…
          </div>
        )}
      </div>
    </div>
  );
}

function Search({ channel }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState([]);
  useEffect(() => {
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api(`/api/channels/${channel.id}/search?q=${encodeURIComponent(q)}`)
        .then((d) => setHits(d.messages || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q, channel.id]);
  return (
    <div style={{ position: "relative" }}>
      <input
        className="searchbox"
        placeholder="Search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && hits.length > 0 && (
        <div className="menu" style={{ right: 0, top: 32, left: "auto", width: 320, maxHeight: 280, overflow: "auto" }}>
          {hits.map((m) => (
            <button key={m.id} onClick={() => setOpen(false)}>
              <b>{displayName(m.author)}</b>: {m.content.slice(0, 60)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function messageMenu(m, me, { setReply, setEditId, setText }) {
  const items = [
    { label: "Reply", onClick: () => { setReply(m); setState({ contextMenu: null }); } },
    { label: "Copy text", onClick: () => { navigator.clipboard?.writeText(m.content || ""); setState({ contextMenu: null }); } },
    {
      label: m.pinned ? "Unpin" : "Pin message",
      onClick: () => {
        api(`/api/messages/${m.id}/pin`, { method: m.pinned ? "DELETE" : "PUT" });
        setState({ contextMenu: null });
      },
    },
  ];
  if (m.author?.id === me.id) {
    items.push({
      label: "Edit message",
      onClick: () => {
        setEditId(m.id);
        setText(m.content);
        setState({ contextMenu: null });
      },
    });
  }
  items.push("-");
  items.push({
    label: "Delete message",
    danger: true,
    onClick: () => {
      api(`/api/messages/${m.id}`, { method: "DELETE" });
      setState({ contextMenu: null });
    },
  });
  return items;
}
