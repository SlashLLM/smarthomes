/* Admin sign-out: expire the session cookie. */

import { createHandler } from "../_lib/handler.js";
import { clearSessionCookie } from "../_lib/admin.js";

export default createHandler(
  async ({ res }) => {
    clearSessionCookie(res);
    return { ok: true };
  },
  { method: "POST", name: "admin-logout" }
);
