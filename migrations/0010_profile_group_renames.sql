DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'households'
    ) THEN
        ALTER TABLE households RENAME TO profile_groups;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'household_members'
    ) THEN
        ALTER TABLE household_members RENAME TO profile_group_members;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profile_group_members'
          AND column_name = 'household_id'
    ) THEN
        ALTER TABLE profile_group_members RENAME COLUMN household_id TO profile_group_id;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'household_id'
    ) THEN
        ALTER TABLE profiles RENAME COLUMN household_id TO profile_group_id;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'watch_events'
          AND column_name = 'household_id'
    ) THEN
        ALTER TABLE watch_events RENAME COLUMN household_id TO profile_group_id;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'watch_history_entries'
          AND column_name = 'household_id'
    ) THEN
        ALTER TABLE watch_history_entries RENAME COLUMN household_id TO profile_group_id;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'provider_import_jobs'
          AND column_name = 'household_id'
    ) THEN
        ALTER TABLE provider_import_jobs RENAME COLUMN household_id TO profile_group_id;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_class c
        INNER JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'i'
          AND c.relname = 'idx_profiles_household_sort'
    ) THEN
        ALTER INDEX idx_profiles_household_sort RENAME TO idx_profiles_profile_group_sort;
    END IF;
END $$;

DO $$
DECLARE
    constraint_row record;
    index_row record;
BEGIN
    FOR constraint_row IN
        SELECT n.nspname AS schema_name,
               c.relname AS table_name,
               con.conname AS constraint_name,
               replace(con.conname, 'household', 'profile_group') AS next_name
        FROM pg_constraint con
        INNER JOIN pg_class c ON c.oid = con.conrelid
        INNER JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND con.conname LIKE '%household%'
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
            constraint_row.schema_name,
            constraint_row.table_name,
            constraint_row.constraint_name,
            constraint_row.next_name
        );
    END LOOP;

    FOR index_row IN
        SELECT n.nspname AS schema_name,
               c.relname AS index_name,
               replace(c.relname, 'household', 'profile_group') AS next_name
        FROM pg_class c
        INNER JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'i'
          AND c.relname LIKE '%household%'
    LOOP
        EXECUTE format(
            'ALTER INDEX %I.%I RENAME TO %I',
            index_row.schema_name,
            index_row.index_name,
            index_row.next_name
        );
    END LOOP;
END $$;
