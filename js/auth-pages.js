// Sign-in and sign-up pages.
(async function () {
  const mode = document.body.dataset.mode,
    signup = mode === "signup",
    $ = (id) => document.getElementById(id),
    form = $("auth-form"),
    error = $("auth-error"),
    submit = $("auth-submit");
  const MESSAGES = {
    credentials_invalid: "That email or password isn’t right.",
    rate_limited: "Too many attempts. Please wait a few minutes and try again.",
    email_invalid: "Enter a valid email address.",
    email_taken: "An account with this email already exists. Sign in instead.",
    name_required: "Enter your name.",
    invite_invalid: "That invite code isn’t valid, has expired, or has already been used.",
    signup_closed: "New sign-ups are closed right now.",
    account_suspended: "This account has been suspended. Contact the site admin.",
    google_invalid: "Google sign-in didn’t work. Please try again.",
    accounts_not_configured: "Accounts aren’t set up on this site yet.",
    same_origin_required: "This request was blocked. Reload the page and try again.",
  };
  function show(message) {
    error.textContent = message;
    error.hidden = !message;
  }
  document.querySelectorAll('[data-only="signup"]').forEach((n) => !signup && n.remove());
  $("auth-title").textContent = signup ? "Create your account" : "Welcome back";
  $("auth-sub").textContent = signup ? "Start tracking your job search in a couple of minutes." : "Sign in to pick up where you left off.";
  submit.textContent = signup ? "Create account" : "Sign in";
  $("f-password").autocomplete = signup ? "new-password" : "current-password";
  $("auth-switch").innerHTML = signup ? 'Already have an account? <a href="/signin">Sign in</a>' : 'New here? <a href="/signup">Create an account</a>';
  $("pw-toggle").onclick = () => {
    let f = $("f-password"),
      showing = f.type === "text";
    f.type = showing ? "password" : "text";
    $("pw-toggle").textContent = showing ? "Show" : "Hide";
    $("pw-toggle").setAttribute("aria-label", showing ? "Show password" : "Hide password");
  };
  let invite = new URLSearchParams(location.search).get("invite") || "";
  if (signup && invite) $("f-invite").value = invite.slice(0, 40);

  // Finish signing in: load the account's data into this browser, or bring in
  // data saved here before accounts existed, then open the app.
  async function enter(user) {
    submit.textContent = "Loading your workspace…";
    localStorage.setItem(LB_USER_KEY, JSON.stringify(user));
    let pulled = await lbPullToLocal(user.id).catch(() => null);
    if (pulled && pulled.count === 0 && lbAnonHasData() && !localStorage.getItem("lb.anon.imported")) {
      localStorage.setItem(lbDataKey(user.id), localStorage.getItem(LB_ANON_KEY));
      localStorage.setItem("lb.anon.imported", user.id);
      localStorage.setItem("lb.import.files", user.id);
    }
    location.replace("/");
  }

  let me = await lbApi("/api/auth/me").catch(() => null);
  if (me?.ok && me.data.user) return enter(me.data.user);
  localStorage.removeItem(LB_USER_KEY);
  let config = (await lbApi("/api/auth/config").catch(() => null))?.data || {};
  if (config.error) show(MESSAGES[config.error] || "The account service isn’t available right now.");
  if (signup) {
    if (config.firstAccount) $("auth-sub").textContent = "You’re the first person here, so this account will be the owner.";
    else if (config.signup === "invite") {
      $("invite-field").hidden = false;
      $("auth-sub").textContent = "The Looney Bin is invite-only for now. Enter the invite code you were given.";
    } else if (config.signup === "closed") {
      show(MESSAGES.signup_closed);
      submit.disabled = true;
    }
  }
  if (lbAnonHasData() && !localStorage.getItem("lb.anon.imported"))
    $("auth-sub").insertAdjacentHTML("afterend", `<p class="auth-note">Resumes and jobs already saved in this browser will be moved into your account${signup ? "" : " if it’s new"}.</p>`);

  form.onsubmit = async (e) => {
    e.preventDefault();
    show("");
    let body = { email: $("f-email").value.trim(), password: $("f-password").value };
    if (signup) {
      body.name = $("f-name").value.trim();
      body.invite = $("f-invite")?.value.trim() || "";
      if (!body.name) return show(MESSAGES.name_required);
      if (body.password.length < 10) return show("Use at least 10 characters for your password.");
      if (!$("invite-field").hidden && !body.invite) return show("Enter your invite code.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) return show(MESSAGES.email_invalid);
    if (!body.password) return show("Enter your password.");
    submit.disabled = true;
    let label = submit.textContent;
    submit.textContent = signup ? "Creating your account…" : "Signing in…";
    let r = await lbApi("/api/auth/" + mode, { method: "POST", body }).catch(() => null);
    if (r?.ok) return enter(r.data.user);
    submit.disabled = false;
    submit.textContent = label;
    show(!r ? "Couldn’t reach the server. Check your connection and try again." : r.data.message || MESSAGES[r.data.error] || "Something went wrong. Please try again.");
  };

  // Google sign-in appears only when a Google client ID is configured.
  if (config.googleClientId) {
    let s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => {
      google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async (res) => {
          show("");
          let r = await lbApi("/api/auth/google", { method: "POST", body: { credential: res.credential, invite: $("f-invite")?.value.trim() || invite } }).catch(() => null);
          if (r?.ok) return enter(r.data.user);
          show(r?.data.error === "invite_invalid" ? "This Google account doesn’t have an account here yet. Sign up with an invite code first." : MESSAGES[r?.data.error] || "Google sign-in didn’t work. Please try again.");
        },
      });
      google.accounts.id.renderButton($("google-btn"), { theme: "outline", size: "large", width: 340, text: signup ? "signup_with" : "signin_with" });
      $("google-box").hidden = false;
    };
    document.head.appendChild(s);
  }
})();
