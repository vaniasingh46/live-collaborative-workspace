# Optional Supabase database setup

Local development does not need Supabase, PostgreSQL, Docker, or any database
configuration. By default the server persists rooms and documents in its local
Git-ignored JSON data file and starts with `npm run dev`.

This guide is retained only for a future hosted PostgreSQL deployment using the
existing Prisma schema and migrations. The current runtime continues to use the
local storage adapter until a PostgreSQL adapter is intentionally configured.

1. Create a project at [Supabase](https://supabase.com/dashboard). Choose a
   project name, region, and a strong database password. Wait until its status
   is **Active**.
2. In that project's **SQL Editor**, run the following SQL once. Choose a long,
   unique value for `CHANGE_THIS_TO_A_SECRET` and keep it only in your password
   manager and local `.env` file:

```sql
create user "prisma" with password 'CHANGE_THIS_TO_A_SECRET' bypassrls createdb;
grant "prisma" to "postgres";
grant usage, create on schema public to prisma;
grant all on all tables in schema public to prisma;
grant all on all routines in schema public to prisma;
grant all on all sequences in schema public to prisma;
alter default privileges for role postgres in schema public grant all on tables to prisma;
alter default privileges for role postgres in schema public grant all on routines to prisma;
alter default privileges for role postgres in schema public grant all on sequences to prisma;
```

3. Click **Connect** in the project dashboard and select **Session pooler**.
   Copy its connection string (it uses port `5432`). Change the username to
   `prisma.<project-ref>` and replace the password with the Prisma role password
   from step 2. Append `?sslmode=require` if it is not already present.
4. Put that complete value in your local `.env` as `DATABASE_URL`. If the
   password contains characters such as `@`, `#`, `?`, `&`, `/`, or a space,
   percent-encode them in the URL. Never put this value in `.env.example` or
   commit `.env`.
5. Run the Prisma commands manually when integrating a PostgreSQL storage
   adapter. They are optional maintenance commands and are not part of local
   startup.

`DATABASE_URL` is server-only. Do not add it to `VITE_*` variables or frontend
code. The browser continues to talk only to the Express/Socket.IO backend.
