# PlanTrack — Universal AI Productivity Suite

[![Version](https://img.shields.io/badge/version-2.5.0-gold.svg)](https://github.com/ayoabimbola16-oss/concentration-tool)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-active-brightgreen.svg)](https://github.com/ayoabimbola16-oss/concentration-tool)

**PlanTrack** is an all-in-one, AI-powered productivity suite designed for students, freelancers, remote teams, businesses, and individuals. It replaces scattered productivity tools with a single unified platform combining ChatGPT-style AI assistance, binaural focus timers, visual timetables, Nexus chat with real camera video calls, and closed-app background alarms.

---

## 🌟 Key Features

### 🤖 1. PlanTrack Genius AI Co-Pilot
- **Conversational Q&A**: Multi-turn chat memory capable of answering general questions across business strategy, study roadmaps, health habits, coding, and day planning.
- **Context-Aware Recommendations**: Leverages real-time app activity (completed focus sessions, pending tasks, active streaks).
- **1-Click Action Sprints**: Convert AI responses directly into actionable PlanTrack Plans & Timetables with a single click.

### ⏱️ 2. Binaural Focus Timer & Streak Recovery
- **Pomodoro & Custom Intervals**: Flexible focus blocks with active state persistence across page refreshes.
- **Embedded Soundscapes**: High-quality Alpha Wave, Beta Wave, Pink Noise, and Rain soundscapes.
- **1-Day Grace Period Protection**: Automatic streak protection so unexpected life events don't wipe out your hard work.

### 💬 3. Nexus Chat, Voice Notes & Video Calls
- **Real-Time Messaging**: Built on Supabase real-time engine with online status indicators.
- **🎤 Audio Voice Notes**: Built-in Web MediaRecorder to record and play voice notes inside chat bubbles.
- **📞 Live Voice & Camera Video Calls**: Connects real-time WebRTC audio and live camera video feeds.
- **📋 Shared Attachment Cards**: Share Timetables, Plans, and Files in chat with 1-click **"Import to My Account"** buttons for both sender and receiver.

### ⏰ 4. Closed-App System Alarms & Reminders
- **Background Service Workers**: Web Notification TimestampTriggers keep alarms firing loud with system vibration and audio alerts even when browser tabs are closed.
- **Action Buttons**: 1-click **Snooze (10m)** and **Dismiss** directly from system notifications.

### 📅 5. Dynamic Timetable & Plan Manager
- **Visual Schedule Builder**: Create weekly class schedules, business shifts, or study blocks.
- **Activity Tracker**: Detailed progress bars, milestone checklists, and completion analytics.

### 👑 6. PlanTrack PRO Subscription System
- **7-Day Free Trial**: Automatic 7 days of full PRO features upon registration.
- **Accessible Pricing**: **$0.50 / month** ($5.00 / year) subscription options.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla CSS3 (Dark Glassmorphism UI), JavaScript ES6+
- **Backend / Database**: PostgreSQL (Supabase Auth, Realtime, Storage & RLS Policies)
- **Service Worker**: PWA Service Worker (`sw.js`) with Web Push & TimestampTrigger Notification API
- **Mobile Bridge**: Capacitor (`@capacitor/android`, `@capacitor/local-notifications`)

---

## 📁 Repository Structure

```
PlanTrack/
├── index.html                 # Main Web Application Hub
├── landing.html               # Clean Product Landing & Marketing Page
├── styles.css                 # Master Glassmorphism CSS Design System
├── app.js                     # Core Application Logic, AI Engine & Chat
├── sw.js                      # Background Service Worker for Closed-App Alarms
├── alarm-service.js           # Alarm Audio & Schedule Manager
├── master-schema.sql          # Consolidated PostgreSQL Database Setup Script
├── config.js                  # Supabase Environment Configuration
└── assets/                    # Branding Icons & Media Assets
```

---

## 🚀 Quick Setup & Installation

### 1. Database Setup (Supabase)
1. Open your **Supabase Project Dashboard** -> **SQL Editor**.
2. Run the consolidated setup script: [`master-schema.sql`](master-schema.sql).
3. This creates all necessary tables (`profiles`, `alarms`, `timetables`, `plans`, `focus_sessions`, `friends`, `messages`), Row-Level Security (RLS) policies, and PRO columns.

### 2. Running Locally
Simply open `landing.html` or `index.html` in your browser or run a local dev server:

```bash
# Using VS Code Live Server or python HTTP server:
python -m http.server 5500
```
Open `http://127.0.0.1:5500/landing.html` in your browser.

---

## 📄 License
This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
