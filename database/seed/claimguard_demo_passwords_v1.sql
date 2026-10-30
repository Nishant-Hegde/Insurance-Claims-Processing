-- Demo login passwords for the synthetic seed users.
-- Apply after claimguard_seed_v1.sql. Synthetic accounts only; never run on real data.
--
-- The original seed used a placeholder hash that matches no known password.
-- This sets real bcrypt (cost 12) hashes so the documented demo passwords work:
--   ADMIN users            ADMIN!Test2026
--   CLAIMS_ADJUSTER users  CLAIMS_ADJUSTER!Test2026
--   POLICYHOLDER users     POLICYHOLDER!Test2026
BEGIN;

UPDATE app_user u
SET    password_hash = CASE r.role_name
         WHEN 'ADMIN'           THEN '$2b$12$UIVMhVRLT9oWqmNTKCrvbOObWuhpcOFrQ7XG1JptSM8HRZWzXrbCm'
         WHEN 'CLAIMS_ADJUSTER' THEN '$2b$12$XJW69SGTmS19HlPCADCkN.dTTAYhspYgvfDaIPdM4wlJCd.CrMPJm'
         WHEN 'POLICYHOLDER'    THEN '$2b$12$1GO7r14Hf.Ir95PGFAEuzunE1zMNrjjcfLovQy5I/7shBAWyAr7d2'
       END
FROM   app_role r
WHERE  r.role_id = u.role_id
  -- only the fixed synthetic seed accounts
  AND  u.user_id::text ~ '^a[123]000000-0000-0000-0000-0000000000[0-9]{2}$';

COMMIT;
