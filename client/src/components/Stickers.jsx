import React, { useEffect, useMemo, useState } from "react";
import { api, assetUrl, uploadFile } from "../lib/api.js";
import { setState } from "../lib/store.js";

export function StickerImg({ url, alt, className, title }) {
  const [fail, setFail] = useState(false);
  if (fail) return <span className="sticker-fallback">{alt || "sticker"}</span>;
  return (
    <img
      className={className}
      src={assetUrl(url)}
      alt={alt || ""}
      title={title || alt || ""}
      draggable={false}
      onError={() => setFail(true)}
    />
  );
}

export function StickerPicker({ onSend, onClose }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("recent");
  const [q, setQ] = useState("");
  const [store, setStore] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    api("/api/stickers/picker")
      .then((d) => {
        setData(d);
        setErr("");
        if (tab === "recent" && !(d.recent || []).length && d.installed?.[0]) {
          setTab(d.installed[0].id);
        }
      })
      .catch((e) => setErr(e.message || "Could not load stickers."));
  }

  useEffect(() => {
    load();
  }, []);

  const installed = data?.installed || [];
  const recent = data?.recent || [];
  const catalog = data?.catalog || [];
  const activePack = installed.find((p) => p.id === tab);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = tab === "recent" ? recent : activePack?.stickers || [];
    if (needle) {
      const all = installed.flatMap((p) => p.stickers || []);
      list = (needle ? all : list).filter(
        (s) =>
          (s.emoji || "").toLowerCase().includes(needle) ||
          (s.filename || "").toLowerCase().includes(needle)
      );
    }
    return list;
  }, [tab, q, recent, activePack, installed]);

  async function send(st) {
    try {
      await onSend(st);
    } catch (e) {
      setErr(e.message || "Could not send.");
    }
  }

  async function toggleInstall(pack) {
    try {
      if (pack.installed) {
        await api(`/api/sticker-packs/${pack.id}/install`, { method: "DELETE" });
      } else {
        await api(`/api/sticker-packs/${pack.id}/install`, { method: "POST", body: {} });
      }
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div className="sticker-picker" onMouseDown={(e) => e.stopPropagation()}>
      <div className="sticker-picker-head">
        <input
          className="sticker-search"
          placeholder={store ? "Search packs" : "Search stickers"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="icon-btn" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      {err && <div className="sticker-err">{err}</div>}
      {store ? (
        <div className="sticker-store">
          <div className="sticker-store-title">Sticker packs</div>
          {catalog
            .filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))
            .map((p) => (
              <div key={p.id} className="sticker-store-row">
                {p.cover_url ? (
                  <StickerImg url={p.cover_url} className="sticker-cover" alt={p.name} />
                ) : (
                  <span className="sticker-cover ph">✦</span>
                )}
                <div className="grow">
                  <div className="strong">{p.name}</div>
                  <div className="muted">
                    {p.count} stickers{p.builtin ? " · built-in" : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className={`btn sm ${p.installed ? "secondary" : ""}`}
                  onClick={() => toggleInstall(p)}
                >
                  {p.installed ? "Remove" : "Add"}
                </button>
              </div>
            ))}
          <p className="muted" style={{ padding: "8px 4px 0", fontSize: 12 }}>
            Make your own pack in User Settings → Stickers.
          </p>
        </div>
      ) : (
        <div className="sticker-grid">
          {!shown.length && <div className="sticker-empty">{q ? "No matches." : "Nothing here yet."}</div>}
          {shown.map((s) => (
            <button key={s.id} type="button" className="sticker-cell" title={s.emoji} onClick={() => send(s)}>
              <StickerImg url={s.url} alt={s.emoji} />
            </button>
          ))}
        </div>
      )}
      <div className="sticker-packs">
        <button
          type="button"
          className={`sticker-pack-tab ${tab === "recent" && !store ? "on" : ""}`}
          title="Recent"
          onClick={() => {
            setStore(false);
            setTab("recent");
          }}
        >
          ⏱
        </button>
        {installed.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`sticker-pack-tab ${tab === p.id && !store ? "on" : ""}`}
            title={p.name}
            onClick={() => {
              setStore(false);
              setTab(p.id);
            }}
          >
            {p.cover_url ? <StickerImg url={p.cover_url} alt={p.name} /> : <span>✦</span>}
          </button>
        ))}
        <button
          type="button"
          className={`sticker-pack-tab add ${store ? "on" : ""}`}
          title="Add packs"
          onClick={() => setStore((v) => !v)}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function StickersSettings() {
  const [mine, setMine] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState(null);
  const [openPack, setOpenPack] = useState(null);
  const [emoji, setEmoji] = useState("✨");

  function load() {
    api("/api/stickers/picker")
      .then((d) => {
        setMine((d.installed || []).filter((p) => p.created_by));
        setCatalog(d.catalog || []);
      })
      .catch((e) => setErr(e.message));
    if (openId) {
      api(`/api/sticker-packs/${openId}`)
        .then((d) => setOpenPack(d.pack))
        .catch(() => {});
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e) {
    e.preventDefault();
    setErr("");
    try {
      const d = await api("/api/sticker-packs", { method: "POST", body: { name } });
      setName("");
      setMsg(`Created ${d.pack.name}. Upload images below.`);
      setOpenId(d.pack.id);
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  async function addFiles(packId, files) {
    setErr("");
    try {
      for (const f of files) {
        const up = await uploadFile(f, "sticker");
        await api(`/api/sticker-packs/${packId}/stickers`, {
          method: "POST",
          body: { url: up.url, filename: up.filename, emoji: emoji || "✨" },
        });
      }
      setMsg("Stickers added.");
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  async function removeSticker(packId, sid) {
    try {
      await api(`/api/sticker-packs/${packId}/stickers/${sid}`, { method: "DELETE" });
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  async function delPack(packId) {
    if (!confirm("Delete this sticker pack for everyone?")) return;
    try {
      await api(`/api/sticker-packs/${packId}`, { method: "DELETE" });
      setOpenId(null);
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  async function toggle(p) {
    try {
      await api(`/api/sticker-packs/${p.id}/install`, { method: p.installed ? "DELETE" : "POST", body: {} });
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  useEffect(() => {
    if (!openId) {
      setOpenPack(null);
      return;
    }
    api(`/api/sticker-packs/${openId}`)
      .then((d) => setOpenPack(d.pack))
      .catch((e) => setErr(e.message));
  }, [openId]);

  const open = openPack;

  return (
    <>
      <h3>Stickers</h3>
      <p className="muted">
        Packs work like Telegram: tap a sticker in chat to send it big. Built-in packs are already in your picker.
        Anyone can make a pack and add it.
      </p>
      {err && <div className="auth-error">{err}</div>}
      {msg && <div className="settings-ok">{msg}</div>}

      <form onSubmit={create} className="sticker-create">
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label>New pack</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pack name" maxLength={40} required />
        </div>
        <button className="btn" type="submit" style={{ alignSelf: "flex-end" }}>
          Create
        </button>
      </form>

      <div className="lab" style={{ paddingLeft: 0 }}>Your packs</div>
      {!mine.length && <p className="muted">You have not created a pack yet.</p>}
      {mine.map((p) => (
        <div key={p.id} className="sticker-store-row">
          {p.cover_url ? <StickerImg url={p.cover_url} className="sticker-cover" alt={p.name} /> : <span className="sticker-cover ph">✦</span>}
          <div className="grow">
            <div className="strong">{p.name}</div>
            <div className="muted">{p.count} stickers</div>
          </div>
          <button type="button" className="btn sm secondary" onClick={() => setOpenId(p.id)}>
            Edit
          </button>
          <button type="button" className="btn sm danger" onClick={() => delPack(p.id)}>
            Delete
          </button>
        </div>
      ))}

      {open && (
        <div className="sticker-edit">
          <div className="strong" style={{ marginBottom: 8 }}>
            Add to {open.name}
          </div>
          <div className="field">
            <label>Emoji for next upload</label>
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} />
          </div>
          <label className="btn sm" style={{ display: "inline-block" }}>
            Upload stickers
            <input
              type="file"
              hidden
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                addFiles(open.id, [...e.target.files]);
                e.target.value = "";
              }}
            />
          </label>
          <div className="sticker-grid settings">
            {(open.stickers || []).map((s) => (
              <div key={s.id} className="sticker-cell wrap">
                <StickerImg url={s.url} alt={s.emoji} />
                <button type="button" className="sticker-x" title="Remove" onClick={() => removeSticker(open.id, s.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="lab" style={{ paddingLeft: 0, marginTop: 16 }}>All packs</div>
      {catalog.map((p) => (
        <div key={p.id} className="sticker-store-row">
          {p.cover_url ? <StickerImg url={p.cover_url} className="sticker-cover" alt={p.name} /> : <span className="sticker-cover ph">✦</span>}
          <div className="grow">
            <div className="strong">{p.name}</div>
            <div className="muted">
              {p.count} stickers{p.builtin ? " · built-in" : ""}
            </div>
          </div>
          <button type="button" className={`btn sm ${p.installed ? "secondary" : ""}`} onClick={() => toggle(p)}>
            {p.installed ? "Remove from picker" : "Add to picker"}
          </button>
        </div>
      ))}
    </>
  );
}

export function isStickerAtt(a) {
  return a?.kind === "sticker" || Boolean(a?.sticker_id);
}

export function openStickerSettings() {
  setState({ settingsOpen: true, settingsTab: "stickers" });
}
