/* ════════════════════════════════════════════════════════════
   ClipStudio — Supabase config + shared Auth/DB layer
   ------------------------------------------------------------
   1. Fill in SUPABASE_URL and SUPABASE_ANON_KEY below with your
      project's values (Supabase dashboard → Project Settings →
      API). The anon key is safe to ship in client-side code.
   2. Run supabase_schema.sql in the Supabase SQL editor to create
      the `calls` table, row-level security and the `recordings`
      storage bucket.

   If the keys are left blank, ClipStudio runs in DEMO MODE using
   the browser's localStorage so the whole flow still works without
   a backend (data stays only on this device).
   ════════════════════════════════════════════════════════════ */

const SUPABASE_URL      = "";   // e.g. "https://abcdefgh.supabase.co"
const SUPABASE_ANON_KEY = "";   // e.g. "eyJhbGciOi..."

const MAX_CALLS = 100;          // keep only the most recent N calls

/* ── client bootstrap ── */
const CS_CONFIGURED =
  /^https:\/\/.+\.supabase\.co/.test(SUPABASE_URL) &&
  typeof SUPABASE_ANON_KEY === "string" && SUPABASE_ANON_KEY.length > 20;

let _sb = null;
if (CS_CONFIGURED) {
  if (window.supabase && window.supabase.createClient) {
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    console.error("Supabase JS library not loaded — falling back to demo mode.");
  }
}
const CS_LIVE = !!_sb;

/* ════════════════════════════════════════════════════════════
   AUTH
   ════════════════════════════════════════════════════════════ */
const Auth = {
  live: CS_LIVE,

  async getUser() {
    if (CS_LIVE) {
      const { data } = await _sb.auth.getUser();
      return data.user || null;
    }
    return MockBackend.currentUser();
  },

  async signUp(email, password) {
    if (CS_LIVE) {
      const { data, error } = await _sb.auth.signUp({ email, password });
      if (error) throw error;
      // If email confirmation is OFF, a session is returned immediately.
      return { user: data.user, needsConfirm: !data.session };
    }
    return MockBackend.signUp(email, password);
  },

  async signIn(email, password) {
    if (CS_LIVE) {
      const { data, error } = await _sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return { user: data.user, needsConfirm: false };
    }
    return MockBackend.signIn(email, password);
  },

  async signOut() {
    if (CS_LIVE) { await _sb.auth.signOut(); }
    else { MockBackend.signOut(); }
  },

  /* Redirect to the auth page if not signed in. Returns the user. */
  async requireAuth(redirect = "auth.html") {
    const user = await this.getUser();
    if (!user) { window.location.replace(redirect); return null; }
    return user;
  },
};

/* ════════════════════════════════════════════════════════════
   DB — call history
   ════════════════════════════════════════════════════════════ */
const DB = {
  /* Save a detected call, upload its audio (best effort) and prune. */
  async addCall({ label, mode, duration_seconds, blob }) {
    if (CS_LIVE) {
      const user = await Auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: row, error } = await _sb
        .from("calls")
        .insert({ user_id: user.id, label, mode, duration_seconds })
        .select()
        .single();
      if (error) throw error;

      if (blob) {
        try {
          const path = `${user.id}/${row.id}.wav`;
          const { error: upErr } = await _sb.storage
            .from("recordings")
            .upload(path, blob, { contentType: "audio/wav", upsert: true });
          if (!upErr) {
            const { data: pub } = _sb.storage.from("recordings").getPublicUrl(path);
            await _sb.from("calls").update({ audio_url: pub.publicUrl }).eq("id", row.id);
            row.audio_url = pub.publicUrl;
          }
        } catch (e) { console.warn("Audio upload skipped:", e.message); }
      }

      await this._prune(user.id);
      return row;
    }
    return MockBackend.addCall({ label, mode, duration_seconds, blob });
  },

  async listCalls(limit = MAX_CALLS) {
    if (CS_LIVE) {
      const { data, error } = await _sb
        .from("calls")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    }
    return MockBackend.listCalls(limit);
  },

  async deleteCall(id) {
    if (CS_LIVE) {
      const user = await Auth.getUser();
      const { error } = await _sb.from("calls").delete().eq("id", id);
      if (error) throw error;
      if (user) {
        try { await _sb.storage.from("recordings").remove([`${user.id}/${id}.wav`]); } catch (e) {}
      }
      return;
    }
    return MockBackend.deleteCall(id);
  },

  /* Keep only the newest MAX_CALLS rows; delete the rest. */
  async _prune(userId) {
    const { data, error } = await _sb
      .from("calls")
      .select("id")
      .order("created_at", { ascending: false });
    if (error || !data || data.length <= MAX_CALLS) return;
    const stale = data.slice(MAX_CALLS).map((r) => r.id);
    if (!stale.length) return;
    await _sb.from("calls").delete().in("id", stale);
    try {
      await _sb.storage.from("recordings").remove(stale.map((id) => `${userId}/${id}.wav`));
    } catch (e) {}
  },
};

/* ════════════════════════════════════════════════════════════
   MOCK BACKEND (demo mode, localStorage only)
   ════════════════════════════════════════════════════════════ */
const MockBackend = {
  _users()    { return JSON.parse(localStorage.getItem("cs_users")   || "{}"); },
  _saveUsers(u){ localStorage.setItem("cs_users", JSON.stringify(u)); },
  _session()  { return localStorage.getItem("cs_session") || null; },

  currentUser() {
    const email = this._session();
    return email ? { id: email, email } : null;
  },

  signUp(email, password) {
    email = (email || "").trim().toLowerCase();
    if (!email || !password) throw new Error("Email and password are required");
    const users = this._users();
    if (users[email]) throw new Error("An account with that email already exists");
    users[email] = { password };
    this._saveUsers(users);
    localStorage.setItem("cs_session", email);
    return { user: { id: email, email }, needsConfirm: false };
  },

  signIn(email, password) {
    email = (email || "").trim().toLowerCase();
    const users = this._users();
    if (!users[email] || users[email].password !== password) {
      throw new Error("Invalid email or password");
    }
    localStorage.setItem("cs_session", email);
    return { user: { id: email, email }, needsConfirm: false };
  },

  signOut() { localStorage.removeItem("cs_session"); },

  _callsKey() { return "cs_calls_" + (this._session() || "anon"); },
  _calls()    { return JSON.parse(localStorage.getItem(this._callsKey()) || "[]"); },
  _saveCalls(c){ localStorage.setItem(this._callsKey(), JSON.stringify(c)); },

  async addCall({ label, mode, duration_seconds, blob }) {
    let audio_url = null;
    if (blob && blob.size < 2_000_000) {  // only persist small clips as data URLs
      audio_url = await new Promise((res) => {
        const r = new FileReader();
        r.onloadend = () => res(r.result);
        r.onerror = () => res(null);
        r.readAsDataURL(blob);
      });
    }
    const calls = this._calls();
    const row = {
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
      label, mode, duration_seconds, audio_url,
      created_at: new Date().toISOString(),
    };
    calls.unshift(row);
    if (calls.length > MAX_CALLS) calls.length = MAX_CALLS;  // prune oldest
    this._saveCalls(calls);
    return row;
  },

  listCalls(limit = MAX_CALLS) {
    return this._calls()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  },

  deleteCall(id) {
    this._saveCalls(this._calls().filter((c) => c.id !== id));
  },
};

/* ── shared UI helper: show a banner when running without Supabase ── */
function csShowConfigBanner() {
  if (CS_LIVE) return;
  const el = document.getElementById("config-banner");
  if (!el) return;
  el.innerHTML =
    "Demo mode — Supabase is not configured, so data is stored only in this browser. " +
    "Add your project keys in <code>supabase-config.js</code> to enable cloud sync.";
  el.style.display = "block";
}
