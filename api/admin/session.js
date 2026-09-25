/* Lets the admin page decide between the login form and the dashboard. */

import { createHandler } from "../_lib/handler.js";
import { isAdmin } from "../_lib/admin.js";

export default createHandler(async ({ req }) => ({ authenticated: isAdmin(req) }), {
  name: "admin-session",
});
