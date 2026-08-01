# PlanTrack — Database Setup Guide

## 🚀 Quick Start (New Installation)

Run **only `master-schema.sql`** in your Supabase SQL Editor to set up everything fresh:

```sql
-- In Supabase → SQL Editor → New Query:
-- Paste the contents of master-schema.sql and Run
```

---

## 📁 Folder Structure

```
database/
├── master-schema.sql          ← ✅ RUN THIS FIRST (full fresh install)
└── migrations/                ← Run these ONLY if upgrading an existing install
    ├── fix-login-policy.sql       Fix login RLS policies
    ├── fix-avatar-column.sql      Add missing avatar column
    ├── fix-friends-rls.sql        Fix friend request RLS
    ├── fix-feedback-and-admin.sql Add admin feedback table
    ├── admin-enhancements.sql     Admin panel features
    ├── focus-sessions.sql         Focus session tracking table
    ├── streak-upgrade.sql         Streak system upgrade
    ├── music-supabase.sql         User music/sounds storage
    ├── supabase-setup.sql         Phase 1 initial setup
    ├── supabase-phase2.sql        Phase 2 feature additions
    ├── update-schema.sql          General schema updates
    ├── message-status-migration.sql  Message read status
    └── add_reactions.sql          Message reactions support
```

---

## ⚠️ Important Notes

- **Never run migration files on a fresh install** — `master-schema.sql` already includes everything
- Migrations are for upgrading an **existing database** that was set up before a certain feature
- All tables use **Row-Level Security (RLS)** — users can only see their own data
- Run migrations **in order** (oldest first) if upgrading step by step

---

## 📋 Tables Created

| Table | Purpose |
|---|---|
| `profiles` | User accounts, usernames, avatars, PRO status |
| `alarms` | User alarms and reminders |
| `timetables` | Visual timetable schedules |
| `plans` | Plans & activity tracker |
| `focus_sessions` | Pomodoro/focus timer logs |
| `friends` | Friend connections & requests |
| `messages` | Nexus chat messages (real-time) |
| `files` | File manager uploads |
| `folders` | File manager folder structure |
| `feedback` | User feedback/support tickets |
