-- Migration 001: database-backed login sessions and role checks.
-- Apply after claimguard_schema_v4.sql:
--   psql -v ON_ERROR_STOP=1 -d <db> -f database/migrations/001_user_session_auth.sql
--
-- The browser only ever holds a random session token. The database stores its
-- SHA-256 hash, so a leaked database dump cannot be replayed as a login cookie.
-- Who a session belongs to, and which role that user has, is resolved here in
-- the database (fn_session_principal / fn_user_has_role), not trusted from the client.
BEGIN;

CREATE TABLE user_session (
    session_id  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid         NOT NULL REFERENCES app_user (user_id) ON DELETE RESTRICT,
    token_hash  char(64)     NOT NULL UNIQUE,      -- SHA-256 hex of the cookie token
    created_at  timestamptz  NOT NULL DEFAULT now(),
    expires_at  timestamptz  NOT NULL,
    revoked_at  timestamptz,                       -- set on logout or user deactivation
    user_agent  varchar(300),
    CONSTRAINT ck_session_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_session_expiry     CHECK (expires_at > created_at
                                            AND expires_at <= created_at + interval '7 days'),
    CONSTRAINT ck_session_revoked    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX ix_user_session_user ON user_session (user_id);
CREATE INDEX ix_user_session_live ON user_session (expires_at) WHERE revoked_at IS NULL;

-- Only an active user may be given a session.
CREATE FUNCTION fn_session_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM app_user WHERE user_id = NEW.user_id AND is_active) THEN
        RAISE EXCEPTION 'user % is not active and cannot sign in', NEW.user_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_session_insert_guard
    BEFORE INSERT ON user_session
    FOR EACH ROW EXECUTE FUNCTION fn_session_insert_guard();

-- Sessions can only be revoked, never edited back to life or reassigned.
CREATE FUNCTION fn_session_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.session_id IS DISTINCT FROM OLD.session_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
        RAISE EXCEPTION 'a session can only be revoked once; other columns are immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_session_update_guard
    BEFORE UPDATE ON user_session
    FOR EACH ROW EXECUTE FUNCTION fn_session_update_guard();

-- Deactivating a user signs them out everywhere immediately.
CREATE FUNCTION fn_revoke_sessions_on_deactivate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE user_session
    SET    revoked_at = now()
    WHERE  user_id = NEW.user_id AND revoked_at IS NULL;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_user_deactivate_revoke_sessions
    AFTER UPDATE OF is_active ON app_user
    FOR EACH ROW WHEN (OLD.is_active AND NOT NEW.is_active)
    EXECUTE FUNCTION fn_revoke_sessions_on_deactivate();

-- Resolve a token hash to the signed-in user and role.
-- Returns no row for unknown, expired or revoked sessions, or inactive users.
CREATE FUNCTION fn_session_principal(p_token_hash char(64))
RETURNS TABLE (session_id uuid, user_id uuid, email varchar, full_name varchar, role_name varchar)
LANGUAGE sql STABLE AS $$
    SELECT s.session_id, u.user_id, u.email, u.full_name, r.role_name
    FROM   user_session s
    JOIN   app_user u ON u.user_id = s.user_id
    JOIN   app_role r ON r.role_id = u.role_id
    WHERE  s.token_hash = p_token_hash
      AND  s.revoked_at IS NULL
      AND  s.expires_at > now()
      AND  u.is_active;
$$;

-- Role check usable from SQL, e.g. SELECT fn_user_has_role(uid, 'ADMIN', 'CLAIMS_ADJUSTER').
CREATE FUNCTION fn_user_has_role(p_user uuid, VARIADIC p_roles text[])
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1
        FROM   app_user u JOIN app_role r ON r.role_id = u.role_id
        WHERE  u.user_id = p_user
          AND  u.is_active
          AND  r.role_name = ANY (p_roles)
    );
$$;

-- Live sessions per user, for the admin screen.
CREATE VIEW v_active_session AS
SELECT s.session_id, s.user_id, u.full_name, u.email, r.role_name,
       s.created_at, s.expires_at
FROM   user_session s
JOIN   app_user u ON u.user_id = s.user_id
JOIN   app_role r ON r.role_id = u.role_id
WHERE  s.revoked_at IS NULL
  AND  s.expires_at > now();

COMMIT;
