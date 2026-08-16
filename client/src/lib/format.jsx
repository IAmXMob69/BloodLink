import React from "react";

export function initials(name = "?") {
  const p = String(name).trim().split(/\s+/);
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

export function displayName(user) {
  if (!user) return "Unknown";
  return user.display_name || user.username || "Unknown";
}

export function tagName(user) {
  if (!user) return "";
  return `${user.username}#${user.tag}`;
}

export function timeLabel(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today at ${time}`;
  if (d.toDateString() === yest.toDateString()) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString()} ${time}`;
}

export function shortTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function shouldGroup(prev, msg) {
  if (!prev || !msg) return false;
  if (prev.system || msg.system) return false;
  if (!prev.author || !msg.author) return false;
  if (prev.author.id !== msg.author.id) return false;
  if (msg.reply_to) return false;
  return msg.created_at - prev.created_at < 7 * 60 * 1000;
}

export function Md({ text }) {
  if (!text) return null;
  const lines = text.split("\n");
  const nodes = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith("```")) {
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      nodes.push(
        <pre key={`c${i}`} className="md-pre">
          <code>{buf.join("\n")}</code>
        </pre>
      );
      continue;
    }
    nodes.push(
      <span key={`l${i}`}>
        {i > 0 ? <br /> : null}
        {inline(lines[i], `${i}`)}
      </span>
    );
    i += 1;
  }
  return <>{nodes}</>;
}

function inline(s, key) {
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|https?:\/\/[^\s<]+|<@[^>]+>)/g;
  const parts = [];
  let last = 0;
  let m;
  let n = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={`${key}${n++}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("*")) parts.push(<em key={`${key}${n++}`}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith("`")) parts.push(<code key={`${key}${n++}`} className="md-code">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("http")) {
      parts.push(
        <a key={`${key}${n++}`} href={tok} target="_blank" rel="noreferrer">
          {tok}
        </a>
      );
    } else if (tok.startsWith("<@")) {
      parts.push(<span key={`${key}${n++}`} className="mention">{tok}</span>);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

export const EMOJIS = [
  "😀", "😂", "🥰", "😍", "😎", "🤔", "😭", "😡", "👍", "👎", "❤️", "🔥",
  "🎉", "✨", "👀", "✅", "❌", "💯", "🙏", "💀", "🤝", "🎯", "⚡", "🏠",
];
