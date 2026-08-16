import React from "react";
import { assetUrl } from "../lib/api.js";
import { initials, displayName } from "../lib/format.jsx";

export default function Avatar({ user, size = "", status }) {
  if (!user) return <div className={`avatar ${size}`} />;
  const st = status || user.status || "offline";
  return (
    <div className={`avatar ${size}`} style={{ background: user.avatar_color || "#e85d04" }}>
      {user.avatar ? <img src={assetUrl(user.avatar)} alt="" /> : initials(displayName(user))}
      <span className={`dot st-${st}`} />
    </div>
  );
}
