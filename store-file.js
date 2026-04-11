const fs = require("fs/promises");
const { createId, hashPassword } = require("./lib-crypto");

class FileStore {
  constructor(config) {
    this.config = config;
    this.state = {
      users: [],
      sessions: [],
      verifications: [],
      portalSettings: {
        site: {},
        modules: {}
      }
    };
    this.persistQueue = Promise.resolve();
    this.mutationQueue = Promise.resolve();
  }

  async initialize() {
    this.state = await this.#loadState();
    this.#normalizeState();
    this.#pruneExpiredRecords();
    await this.#ensureDefaultAdmin();
    await this.#persist();
  }

  #clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : value;
  }

  #normalizeState() {
    if (!this.state.portalSettings || typeof this.state.portalSettings !== "object") {
      this.state.portalSettings = {
        site: {},
        modules: {}
      };
    }

    this.state.portalSettings.site =
      this.state.portalSettings.site && typeof this.state.portalSettings.site === "object"
        ? this.state.portalSettings.site
        : {};

    this.state.portalSettings.modules =
      this.state.portalSettings.modules && typeof this.state.portalSettings.modules === "object"
        ? this.state.portalSettings.modules
        : {};

    this.state.users = this.state.users.map((user) => ({
      status: "active",
      ...user
    }));
  }

  async #loadState() {
    try {
      const raw = await fs.readFile(this.config.paths.storeFile, "utf8");
      const parsed = JSON.parse(raw);
      return {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        verifications: Array.isArray(parsed.verifications) ? parsed.verifications : [],
        portalSettings:
          parsed.portalSettings && typeof parsed.portalSettings === "object"
            ? parsed.portalSettings
            : {
                site: {},
                modules: {}
              }
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      return {
        users: [],
        sessions: [],
        verifications: [],
        portalSettings: {
          site: {},
          modules: {}
        }
      };
    }
  }

  async #ensureDefaultAdmin() {
    const adminSeed = this.config.adminSeed;
    const hasAdmin = this.state.users.some((user) => user.role === "admin");

    if (hasAdmin) {
      const adminWithoutEmail = this.state.users.find((user) => user.role === "admin" && !user.email);
      if (adminWithoutEmail) {
        adminWithoutEmail.email = adminSeed.email;
      }

      const adminWithoutStatus = this.state.users.find((user) => user.role === "admin" && !user.status);
      if (adminWithoutStatus) {
        adminWithoutStatus.status = "active";
      }
      return;
    }

    const timestamp = new Date().toISOString();
    const passwordPayload = await hashPassword(adminSeed.password);

    this.state.users.push({
      id: createId("user"),
      username: adminSeed.username,
      displayName: adminSeed.displayName,
      email: adminSeed.email,
      role: "admin",
      status: "active",
      passwordHash: passwordPayload.hash,
      salt: passwordPayload.salt,
      createdAt: timestamp,
      lastLoginAt: timestamp
    });
  }

  #pruneExpiredRecords() {
    const now = Date.now();
    this.state.sessions = this.state.sessions.filter((session) => Date.parse(session.expiresAt) > now);
    this.state.verifications = this.state.verifications.filter(
      (entry) =>
        Date.parse(entry.expiresAt) > now &&
        entry.attempts < this.config.auth.maxVerificationAttempts
    );
  }

  async #persist() {
    const snapshot = JSON.stringify(this.state, null, 2);

    this.persistQueue = this.persistQueue.then(async () => {
      await fs.mkdir(this.config.paths.dataDir, {
        recursive: true
      });

      const tempFile = `${this.config.paths.storeFile}.tmp`;
      await fs.writeFile(tempFile, snapshot, "utf8");
      await fs.rename(tempFile, this.config.paths.storeFile);
    });

    return this.persistQueue;
  }

  async #withMutation(action) {
    const task = this.mutationQueue.then(action, action);
    this.mutationQueue = task.catch(() => {});
    return task;
  }

  findUserById(userId) {
    return this.#clone(this.state.users.find((user) => user.id === userId) || null);
  }

  findUserByEmail(email) {
    return this.#clone(this.state.users.find((user) => user.email === email) || null);
  }

  findUserByUsername(username) {
    return this.#clone(
      this.state.users.find((user) => user.username.toLowerCase() === username.toLowerCase()) || null
    );
  }

  findUserByLogin(account, normalizedEmail) {
    return this.#clone(
      this.state.users.find(
        (user) =>
          user.username.toLowerCase() === account.toLowerCase() || user.email === normalizedEmail
      ) || null
    );
  }

  listUsers() {
    return this.#clone(this.state.users);
  }

  getPortalSettings() {
    return this.#clone(this.state.portalSettings);
  }

  getDiagnostics() {
    this.#pruneExpiredRecords();
    return {
      users: this.state.users.length,
      sessions: this.state.sessions.length,
      verifications: this.state.verifications.length
    };
  }

  getSessionContext(tokenHash) {
    this.#pruneExpiredRecords();
    const session = this.state.sessions.find((item) => item.tokenHash === tokenHash);
    if (!session) {
      return null;
    }

    const user = this.state.users.find((item) => item.id === session.userId);
    if (!user) {
      return null;
    }

    return this.#clone({
      session,
      user
    });
  }

  async createUser(userInput) {
    return this.#withMutation(async () => {
      const user = {
        id: createId("user"),
        ...userInput
      };

      this.state.users.push(user);
      await this.#persist();
      return this.#clone(user);
    });
  }

  async touchUserLastLogin(userId, lastLoginAt) {
    return this.#withMutation(async () => {
      const target = this.state.users.find((user) => user.id === userId);
      if (!target) {
        return null;
      }

      target.lastLoginAt = lastLoginAt;
      await this.#persist();
      return this.#clone(target);
    });
  }

  async updateUser(userId, patch) {
    return this.#withMutation(async () => {
      const target = this.state.users.find((user) => user.id === userId);
      if (!target) {
        return null;
      }

      Object.assign(target, patch);
      await this.#persist();
      return this.#clone(target);
    });
  }

  async deleteUser(userId) {
    return this.#withMutation(async () => {
      const existing = this.state.users.find((user) => user.id === userId);
      if (!existing) {
        return null;
      }

      this.state.users = this.state.users.filter((user) => user.id !== userId);
      this.state.sessions = this.state.sessions.filter((session) => session.userId !== userId);
      await this.#persist();
      return this.#clone(existing);
    });
  }

  async replaceUserPassword(userId, passwordPayload) {
    return this.#withMutation(async () => {
      const target = this.state.users.find((user) => user.id === userId);
      if (!target) {
        return null;
      }

      target.passwordHash = passwordPayload.hash;
      target.salt = passwordPayload.salt;
      await this.#persist();
      return this.#clone(target);
    });
  }

  async createSession({ userId, tokenHash, expiresAt }) {
    return this.#withMutation(async () => {
      this.#pruneExpiredRecords();

      const otherSessions = this.state.sessions.filter((item) => item.userId !== userId);
      const keepCount = Math.max(0, this.config.auth.maxSessionsPerUser - 1);
      const currentSessions = this.state.sessions
        .filter((item) => item.userId === userId)
        .slice(-keepCount);

      const session = {
        id: createId("session"),
        userId,
        tokenHash,
        createdAt: new Date().toISOString(),
        expiresAt
      };

      this.state.sessions = [...otherSessions, ...currentSessions, session];
      await this.#persist();
      return this.#clone(session);
    });
  }

  async deleteSession(sessionId) {
    return this.#withMutation(async () => {
      this.state.sessions = this.state.sessions.filter((session) => session.id !== sessionId);
      await this.#persist();
    });
  }

  async deleteSessionsForUser(userId) {
    return this.#withMutation(async () => {
      this.state.sessions = this.state.sessions.filter((session) => session.userId !== userId);
      await this.#persist();
    });
  }

  async createVerification(entryInput) {
    return this.#withMutation(async () => {
      const entry = {
        id: createId("verify"),
        attempts: 0,
        createdAt: new Date().toISOString(),
        ...entryInput
      };

      this.state.verifications = this.state.verifications.filter(
        (item) => !(item.purpose === entry.purpose && item.email === entry.email)
      );
      this.state.verifications.push(entry);
      await this.#persist();
      return this.#clone(entry);
    });
  }

  async removeVerification(purpose, email) {
    return this.#withMutation(async () => {
      this.state.verifications = this.state.verifications.filter(
        (entry) => !(entry.purpose === purpose && entry.email === email)
      );
      await this.#persist();
    });
  }

  async consumeVerification({ purpose, email, codeHash }) {
    return this.#withMutation(async () => {
      this.#pruneExpiredRecords();

      const entry = this.state.verifications.find(
        (item) => item.purpose === purpose && item.email === email
      );

      if (!entry) {
        return {
          status: "missing"
        };
      }

      if (entry.codeHash !== codeHash) {
        entry.attempts += 1;
        if (entry.attempts >= this.config.auth.maxVerificationAttempts) {
          this.state.verifications = this.state.verifications.filter((item) => item.id !== entry.id);
        }
        await this.#persist();
        return {
          status: "invalid"
        };
      }

      this.state.verifications = this.state.verifications.filter((item) => item.id !== entry.id);
      await this.#persist();
      return {
        status: "ok",
        entry: this.#clone(entry)
      };
    });
  }

  async updatePortalSite(sitePatch) {
    return this.#withMutation(async () => {
      this.state.portalSettings.site = {
        ...this.state.portalSettings.site,
        ...sitePatch
      };
      await this.#persist();
      return this.#clone(this.state.portalSettings.site);
    });
  }

  async updatePortalModule(moduleKey, modulePatch) {
    return this.#withMutation(async () => {
      const existing = this.state.portalSettings.modules[moduleKey] || {};
      this.state.portalSettings.modules[moduleKey] = {
        ...existing,
        ...modulePatch
      };
      await this.#persist();
      return this.#clone(this.state.portalSettings.modules[moduleKey]);
    });
  }

  async updatePortalModules(moduleEntries) {
    return this.#withMutation(async () => {
      moduleEntries.forEach(({ key, patch }) => {
        const existing = this.state.portalSettings.modules[key] || {};
        this.state.portalSettings.modules[key] = {
          ...existing,
          ...patch
        };
      });

      await this.#persist();
      return this.#clone(this.state.portalSettings.modules);
    });
  }
}

module.exports = {
  FileStore
};
