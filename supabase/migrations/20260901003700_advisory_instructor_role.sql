-- Enum values must be committed before PostgreSQL permits their use in
-- policies and functions, so the role addition is isolated in this migration.
alter type public.admin_role add value if not exists 'advisory_instructor';
