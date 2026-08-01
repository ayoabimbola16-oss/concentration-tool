#!/usr/bin/env python3
"""
PlanTrack AI Engine (ai_engine.py)
----------------------------------
Python AI Engine for PlanTrack Universal Productivity Suite.
Processes natural language queries with full user context awareness:
- User Profile (Username, Join Date, PRO status)
- Focus Sessions & Total Minutes Today
- Daily Streaks & Grace Period Status
- Active Plans, Completed Tasks & Timetables
"""

import sys
import json
import re

def process_prompt(prompt, context):
    username = context.get('username', 'User').strip()
    upper_user = username.upper()
    sessions = context.get('sessionsToday', 0)
    focus_mins = context.get('focusMinsToday', 0)
    streak = context.get('streakDays', 0)
    pending_tasks = context.get('pendingTasksCount', 0)
    active_plans = context.get('activePlansCount', 0)
    
    lower_prompt = prompt.lower().strip()
    
    # 1. GREETING HANDLERS
    if re.search(r'\b(good morning|morning)\b', lower_prompt):
        return {
            "reply": f"GOOD MORNING {upper_user}! ☀️ How can I help you achieve your goals today?",
            "action": None
        }
    elif re.search(r'\b(good afternoon|afternoon)\b', lower_prompt):
        return {
            "reply": f"GOOD AFTERNOON {upper_user}! 🌤️ Ready for your afternoon focus sprint?",
            "action": None
        }
    elif re.search(r'\b(good evening|evening)\b', lower_prompt):
        return {
            "reply": f"GOOD EVENING {upper_user}! 🌙 How did your activities go today?",
            "action": None
        }
    elif re.search(r'\b(hello|hi|hey|greetings|wassup|sup)\b', lower_prompt):
        return {
            "reply": f"HELLO {upper_user}! 👋 I am your PlanTrack AI Co-Pilot. You have completed {sessions} focus session(s) ({focus_mins} mins) today with a {streak}-day active streak! How can I assist you?",
            "action": None
        }
    
    # 2. USER STATS & ACTIVITY INQUIRY
    elif any(k in lower_prompt for k in ['what have i done', 'my stats', 'my progress', 'my activity', 'summary', 'streak']):
        return {
            "reply": f"📊 <strong>Here is your PlanTrack Activity Summary, {username}:</strong><br/><br/>"
                     f"🔥 <strong>Focus Streak:</strong> {streak} Day(s)<br/>"
                     f"⏱️ <strong>Focus Today:</strong> {sessions} Session(s) ({focus_mins} Minutes)<br/>"
                     f"📋 <strong>Active Plans:</strong> {active_plans} Plan(s)<br/>"
                     f"✅ <strong>Pending Tasks:</strong> {pending_tasks} Task(s) remaining.<br/><br/>"
                     f"<em>Keep going! You're making steady progress.</em>",
            "action": "view_stats"
        }
        
    # 3. PLAN / STRATEGY CREATION
    elif any(k in lower_prompt for k in ['create plan', 'make plan', 'build plan', 'roadmap', 'schedule', 'python', 'business', 'learn']):
        return {
            "reply": f"🎯 <strong>Custom Action Plan generated for {username}:</strong><br/><br/>"
                     f"Based on your query <em>\"{prompt}\"</em>, I've designed a 3-step structured plan:<br/>"
                     f"1️⃣ <strong>Phase 1 (Setup):</strong> Define core requirements and initial 45-min focus block.<br/>"
                     f"2️⃣ <strong>Phase 2 (Execution):</strong> Complete key deliverables and log activity.<br/>"
                     f"3️⃣ <strong>Phase 3 (Review):</strong> Share progress update in Nexus Chat with your team.<br/><br/>"
                     f"Would you like to import this plan directly into your PlanTrack account?",
            "action": "create_plan"
        }
        
    # 4. GENERAL ACCURATE RESPONSE
    else:
        return {
            "reply": f"Here is a tailored guide for <strong>\"{prompt}\"</strong>, {username}:<br/><br/>"
                     f"To achieve this effectively, divide your objective into 25-30 minute focus sprints using PlanTrack's Focus Timer. Break large goals into daily actionable steps.<br/><br/>"
                     f"<em>Would you like me to schedule dedicated focus blocks for this objective?</em>",
            "action": "general"
        }

if __name__ == "__main__":
    if len(sys.argv) > 1:
        try:
            payload = json.loads(sys.argv[1])
            prompt = payload.get('prompt', '')
            context = payload.get('context', {})
            result = process_prompt(prompt, context)
            print(json.dumps(result))
        except Exception as e:
            print(json.dumps({"reply": f"Error: {str(e)}", "action": None}))
    else:
        print(json.dumps({"status": "PlanTrack Python AI Engine Ready"}))
