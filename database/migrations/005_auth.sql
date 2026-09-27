-- Better Auth email/password tables plus explicit AirCheck roles.
CREATE TABLE IF NOT EXISTS "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
    image TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "session" (
    id TEXT PRIMARY KEY,
    "expiresAt" TIMESTAMP NOT NULL,
    token TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_better_auth_session_user ON "session"("userId");

CREATE TABLE IF NOT EXISTS "account" (
    id TEXT PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP,
    "refreshTokenExpiresAt" TIMESTAMP,
    scope TEXT,
    password TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_better_auth_account_provider
    ON "account"("providerId", "accountId");
CREATE INDEX IF NOT EXISTS idx_better_auth_account_user ON "account"("userId");

CREATE TABLE IF NOT EXISTS "verification" (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP DEFAULT NOW(),
    "updatedAt" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_better_auth_verification_identifier
    ON "verification"(identifier);

CREATE TABLE IF NOT EXISTS aircheck_access_roles (
    user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'operator', 'owner')),
    operator_expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (role = 'operator' OR operator_expires_at IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_aircheck_single_owner
    ON aircheck_access_roles(role) WHERE role = 'owner';

CREATE TABLE IF NOT EXISTS aircheck_access_audit (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    subject_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    previous_role TEXT,
    new_role TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aircheck_access_audit_created
    ON aircheck_access_audit(created_at DESC, id DESC);
