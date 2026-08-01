# PlanTrack — Universal AI Productivity Suite

[![Version](https://img.shields.io/badge/version-3.0.0-gold.svg)](https://github.com/ayoabimbola16-oss/concentration-tool)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-active-brightgreen.svg)](https://github.com/ayoabimbola16-oss/concentration-tool)
[![PWA](https://img.shields.io/badge/PWA-ready-blueviolet.svg)](manifest.json)

> **PlanTrack** is an all-in-one AI-powered productivity suite for students, teams, businesses, and individuals — combining ChatGPT-style AI, binaural focus timers, smart timetables, Nexus real-time chat, voice/video calls, and background alarms.

---

## 🌟 Key Features

| Feature | Description |
|---|---|
| 🤖 **AI Co-Pilot** | Conversational AI that knows your full app activity — tasks, streaks, friends, timetables |
| ⏱️ **Focus Timer** | Pomodoro + binaural soundscapes (Alpha, Beta, Pink Noise, Rain) |
| 📅 **Smart Timetable** | Visual column-chip builder + 6 templates + AI auto-generation |
| 💬 **Nexus Chat** | Real-time messaging, voice notes, file sharing, idea cards |
| 📞 **Video & Voice Calls** | WebRTC peer-to-peer calls with camera mirroring |
| ⏰ **Background Alarms** | Service Worker alarms that fire even when browser is closed |
| 📁 **File Manager** | Upload, organize, and share files in folders |
| 📋 **Plans & Activities** | Milestone trackers with progress bars |
| 👑 **PRO Subscription** | 7-day free trial · $0.50/month · $5.00/year |

---

## 📁 Project Structure

```
PlanTrack/
│
├── 🌐 FRONTEND (Web App)
│   ├── landing.html            Entry point — marketing/product landing page
│   ├── index.html              Main web application (shown after login)
│   ├── styles.css              Master CSS design system (dark glassmorphism)
│   ├── app.js                  Core application logic, AI engine, chat, alarms
│   ├── sw.js                   Background Service Worker (closed-app alarms)
│   ├── alarm-service.js        Cross-platform alarm adapter (Web + Android)
│   ├── offline.js              PWA offline handler + notification permission
│   └── config.js               Supabase environment configuration
│
├── 📱 MOBILE (Android via Capacitor)
│   ├── capacitor.config.json   Capacitor bridge configuration
│   ├── android/                Android Studio project (generated)
│   └── www/                    Capacitor web bundle output
│
├── 🗄️ DATABASE (Supabase / PostgreSQL)
│   ├── database/
│   │   ├── README.md           ← Read this before running any SQL
│   │   ├── master-schema.sql   ← Run this for fresh install (all-in-one)
│   │   └── migrations/         Individual migration files (for upgrades only)
│
├── 🖼️ ASSETS
│   └── assets/
│       └── images/
│           ├── logo.jpeg           App logo (used in UI + notifications)
│           ├── logo-alt.jpeg       Alternate logo
│           └── plantrack_icon.png  PWA icon
│
├── 📚 DOCS
│   └── docs/
│       ├── ai_engine.py        Python AI engine reference implementation
│       └── models.json         AI model configuration reference
│
├── 📄 PROJECT FILES
│   ├── manifest.json           PWA web app manifest
│   ├── package.json            Node dependencies (Capacitor CLI)
│   ├── .gitignore              Git ignore rules
│   └── README.md               This file
```

---

## 🚀 Quick Start

### 1. Database Setup (Supabase — do this first)

1. Open your **Supabase Project Dashboard → SQL Editor**
2. Run: [`database/master-schema.sql`](database/master-schema.sql)
3. This creates all tables, RLS policies, and PRO columns in one shot

> See [`database/README.md`](database/README.md) for the full migration guide.

### 2. Configure Supabase Keys

Edit [`config.js`](config.js) and add your project URL and anon key:
```js
const SUPABASE_URL  = 'https://your-project.supabase.co';
const SUPABASE_ANON = 'your-anon-key-here';
```

### 3. Run the Web App

```bash
# Open in browser directly:
open landing.html

# Or serve locally with Python:
python -m http.server 5500
# Then open: http://localhost:5500/landing.html
```

### 4. Build for Android (Optional)

```bash
npm install
npx cap sync android
npx cap open android   # Opens Android Studio
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | HTML5, Vanilla CSS3, JavaScript ES6+ |
| **Backend / DB** | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| **PWA** | Service Worker, Web Push, TimestampTrigger |
| **Mobile** | Capacitor (Android bridge) |
| **AI** | Gemini API (via config.js key) |
| **Fonts** | Google Fonts — Playfair Display, DM Sans |

---

## 📱 App Flow

```
New User:    landing.html → Sign Up → Complete Profile → App Dashboard
Returning:   index.html   → Auto-login → App Dashboard
```

---

## 🔔 Background Alarms

Alarms work in three modes:
1. **App open**: Direct JavaScript alarm checker (every 30s)
2. **Browser open, tab closed**: Service Worker periodic sync
3. **Browser closed (Android PWA)**: Native AlarmManager via Capacitor

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

*Built with ❤️ by the PlanTrack Team*
