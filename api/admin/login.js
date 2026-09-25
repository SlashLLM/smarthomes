/* Admin sign-in: compare against ADMIN_PASSWORD and set the session cookie. */

import { createHandler, ApiError } from "../_lib/handler.js";
import { RATE_LIMIT } from "../_lib/config.js";
import { checkPassword, setSessionCookie } from "../_lib/admin.js";

export default createHandler(
  async ({ body, res }) => {
    if (!checkPassword(body.password)) {
      // Flat delay on failure: cheap friction on top of the rate limit.
      await new Promise((r) => setTimeout(r, 600));
      throw new ApiError(401, "invalid_password", "Incorrect password.");
    }
    setSessionCookie(res);
    return { ok: true };
  },
  { method: "POST", name: "admin-login", rateLimit: RATE_LIMIT.adminLogin }
);
