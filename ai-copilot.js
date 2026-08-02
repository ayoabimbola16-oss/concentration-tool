/* PlanTrack AI Co-Pilot: activity-aware browser client. */
(function () {
  'use strict';

  const actionPrompts = {
    generate_timetable: 'Create a timetable for my day.',
    breakdown_tasks: 'Create a plan from my unfinished activities.',
    reschedule_gaps: 'Help me schedule my unfinished activities.',
    focus_advice: 'Give me focus advice based on today.',
  };

  const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);

  const localReply = (prompt, context) => {
    const text = prompt.toLowerCase();
    const name = context.user.name || 'there';
    const pending = context.activity.pending_count;
    if (/(timetable|schedule|calendar)/.test(text)) {
      return {
        reply: `I made a focused starter schedule, ${name}. You can save it and edit every block afterwards.`,
        action: { type: 'create_timetable', title: 'AI Focus Schedule', columns: ['Time', 'Activity', 'Mode'], rows: [
          ['09:00–10:30', 'Top priority', 'Deep work'], ['10:30–10:45', 'Break', 'Recovery'],
          ['10:45–12:00', 'Next activity', 'Focus'], ['16:30–16:45', 'Review', 'Plan tomorrow']
        ] }
      };
    }
    if (/(plan|goal|roadmap|break down|breakdown)/.test(text)) {
      return {
        reply: `Let’s make this manageable, ${name}. I created a three-step plan you can save to your account.`,
        action: { type: 'create_plan', title: `AI Plan: ${prompt.slice(0, 55)}`, activities: [
          { text: 'Define the smallest useful outcome', status: null },
          { text: 'Complete one 45-minute focus block', status: null },
          { text: 'Review progress and choose the next step', status: null }
        ] }
      };
    }
    if (/(progress|activity|summary|stats|what have i)/.test(text)) {
      return { reply: `Today you have focused for ${context.focus.minutes_today} minutes and have ${pending} unfinished activity item(s). Choose one important item and give it your next 25–45 minute block.`, action: { type: 'open_focus' } };
    }
    return { reply: `I’m here with you, ${name}. Tell me what you want to achieve, how much time you have, and what is blocking you. I can make a plan or timetable from it. You currently have ${pending} unfinished activity item(s).`, action: null };
  };

  async function buildContext() {
    const plans = typeof allPlans !== 'undefined' && Array.isArray(allPlans) ? allPlans : [];
    const activityItems = plans.flatMap(plan => (plan.activities || []).map(activity => ({
      plan: plan.title || 'Untitled plan', text: activity.text || activity.title || 'Activity', status: activity.status || 'pending'
    })));
    const pending = activityItems.filter(item => item.status !== 'done' && item.status !== 'completed');
    const snapshot = {
      user: { name: typeof currentUserProfile !== 'undefined' && currentUserProfile?.username || 'User' },
      focus: { minutes_today: Math.round(((typeof focusTotalSecs !== 'undefined' ? focusTotalSecs : 0) || 0) / 60), sessions_today: typeof focusSessionsToday !== 'undefined' ? focusSessionsToday : 0 },
      activity: { pending_count: pending.length, completed_count: activityItems.length - pending.length, pending_items: pending.slice(0, 12) },
      plans: plans.slice(0, 8).map(plan => ({ title: plan.title, duration: plan.duration, end_date: plan.end_date })),
      timetables: []
    };

    if (typeof db === 'undefined' || typeof currentUserId === 'undefined' || !currentUserId) return snapshot;
    const [{ data: freshPlans }, { data: timetables }, { data: sessions }] = await Promise.all([
      db.from('plans').select('title,duration,end_date,activities').eq('user_id', currentUserId).order('created_at', { ascending: false }).limit(10),
      db.from('timetables').select('*').eq('user_id', currentUserId).order('created_at', { ascending: false }).limit(5),
      db.from('focus_sessions').select('*').eq('user_id', currentUserId).order('created_at', { ascending: false }).limit(30),
    ]).catch(() => [{ data: null }, { data: null }, { data: null }]);

    if (freshPlans) {
      snapshot.plans = freshPlans.map(plan => ({ title: plan.title, duration: plan.duration, end_date: plan.end_date }));
      const freshActivities = freshPlans.flatMap(plan => (plan.activities || []).map(activity => ({ plan: plan.title, text: activity.text || activity.title || 'Activity', status: activity.status || 'pending' })));
      const freshPending = freshActivities.filter(item => item.status !== 'done' && item.status !== 'completed');
      snapshot.activity = { pending_count: freshPending.length, completed_count: freshActivities.length - freshPending.length, pending_items: freshPending.slice(0, 12) };
    }
    if (timetables) snapshot.timetables = timetables.map(item => ({ title: item.title || item.tt_type || 'Timetable', rows: (item.rows || []).slice(0, 6) }));
    if (sessions) {
      snapshot.focus.sessions_today = sessions.length;
      snapshot.focus.minutes_today = sessions.reduce((total, item) => total + Number(item.duration_mins || item.duration_minutes || Math.round((item.duration_secs || 0) / 60)), 0);
    }
    return snapshot;
  }

  function ensureModal() {
    let modal = document.getElementById('modal-ai-copilot');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'modal-ai-copilot';
    modal.className = 'overlay';
    modal.style.cssText = 'display:none;z-index:10020;background:rgba(0,0,0,.65);align-items:center;justify-content:center;padding:16px';
    modal.innerHTML = `<div style="width:min(720px,100%);max-height:86vh;display:flex;flex-direction:column;background:#171820;border:1px solid rgba(255,255,255,.15);border-radius:16px;overflow:hidden;color:#fff"><div style="display:flex;justify-content:space-between;align-items:center;padding:16px 18px;background:linear-gradient(135deg,#56327b,#234d78)"><strong>🤖 PlanTrack AI Co-Pilot</strong><button type="button" data-ai-close style="background:none;border:0;color:#fff;font-size:22px;cursor:pointer">×</button></div><div id="ai-context-text" style="padding:12px 16px;color:#c9cbd5;font-size:.85rem"></div><div id="ai-chat-log" style="min-height:260px;overflow:auto;padding:0 16px 16px;display:flex;flex-direction:column;gap:12px"></div><form id="ai-prompt-form" style="display:flex;gap:8px;padding:14px;border-top:1px solid rgba(255,255,255,.1)"><input id="ai-prompt-input" placeholder="Ask about your day, create a plan or timetable…" style="flex:1;padding:12px;border-radius:9px;border:1px solid #4a4d5a;background:#252733;color:#fff"><button class="btn-save" type="submit">Send</button></form></div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-ai-close]').onclick = () => { modal.style.display = 'none'; };
    modal.querySelector('#ai-prompt-form').onsubmit = event => { event.preventDefault(); window.submitCustomAIPrompt(); };
    return modal;
  }

  function appendMessage(role, text, action) {
    const log = document.getElementById('ai-chat-log');
    if (!log) return;
    const row = document.createElement('div');
    row.style.cssText = `display:flex;justify-content:${role === 'user' ? 'flex-end' : 'flex-start'};gap:8px`;
    const bubble = document.createElement('div');
    bubble.style.cssText = `max-width:82%;padding:11px 13px;border-radius:12px;white-space:pre-wrap;line-height:1.45;background:${role === 'user' ? 'rgba(240,192,64,.2)' : 'rgba(255,255,255,.08)'};`;
    bubble.textContent = text;
    row.appendChild(bubble);
    if (action?.type === 'create_plan' || action?.type === 'create_timetable') {
      const button = document.createElement('button');
      button.className = 'btn-save';
      button.type = 'button';
      button.style.cssText = 'align-self:flex-start;font-size:.8rem;padding:7px 10px';
      button.textContent = action.type === 'create_plan' ? 'Save plan' : 'Save timetable';
      button.onclick = () => saveAction(action, button);
      row.appendChild(button);
    } else if (action?.type === 'open_focus') {
      const button = document.createElement('button');
      button.className = 'btn-save'; button.type = 'button'; button.textContent = 'Open focus timer';
      button.onclick = () => { document.getElementById('modal-ai-copilot').style.display = 'none'; window.showSection?.('focustimer'); };
      row.appendChild(button);
    }
    log.appendChild(row); log.scrollTop = log.scrollHeight;
  }

  async function saveAction(action, button) {
    if (typeof db === 'undefined' || typeof currentUserId === 'undefined' || !currentUserId) return;
    button.disabled = true; button.textContent = 'Saving…';
    let error;
    if (action.type === 'create_plan') {
      ({ error } = await db.from('plans').insert({ user_id: currentUserId, title: action.title || 'AI Plan', duration: 'daily', start_date: today(), end_date: today(), activities: action.activities || [] }));
    } else {
      ({ error } = await db.from('timetables').insert({ user_id: currentUserId, title: action.title || 'AI Timetable', type: 'AI schedule', columns: action.columns || ['Time', 'Activity'], rows: action.rows || [] }));
    }
    if (error) { button.disabled = false; button.textContent = `Could not save: ${error.message}`; return; }
    button.textContent = 'Saved ✓';
    window.loadPlans?.(); window.loadTimetables?.(); window.toast?.('AI draft saved to your account.', 'success');
  }

  async function requestReply(prompt, context) {
    const endpoint = typeof AI_COPILOT_ENDPOINT === 'string' ? AI_COPILOT_ENDPOINT.trim() : '';
    if (!endpoint) return localReply(prompt, context);
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, context }) });
    if (!response.ok) throw new Error('AI service is unavailable');
    return response.json();
  }

  window.openAICoPilot = async function () {
    const modal = ensureModal();
    modal.style.display = 'flex';
    const contextEl = document.getElementById('ai-context-text');
    if (contextEl) contextEl.textContent = 'Reading your plans, activities, timetable and focus progress…';
    const context = await buildContext();
    if (contextEl) contextEl.textContent = `Today: ${context.focus.minutes_today} focus minutes · ${context.activity.pending_count} unfinished activities · ${context.plans.length} plan(s). Your activity details stay in your account.`;
  };

  window.askAICoPilot = function (action) { window.submitCustomAIPrompt(actionPrompts[action] || action || 'Help me plan my day.'); };
  window.submitCustomAIPrompt = async function (preset) {
    const input = document.getElementById('ai-prompt-input');
    const prompt = typeof preset === 'string' && preset ? preset : input?.value.trim();
    if (!prompt) return;
    if (input) input.value = '';
    appendMessage('user', prompt);
    const context = await buildContext();
    try {
      const result = await requestReply(prompt, context);
      appendMessage('ai', result.reply, result.action);
    }
    catch (error) { appendMessage('ai', `I could not reach the online AI service, so I can still help from your activity data: ${localReply(prompt, context).reply}`, localReply(prompt, context).action); }
  };

  // Older Android bundles do not have the original AI navigation button.
  // Add a small launcher there while leaving the website's existing button alone.
  if (!document.getElementById('ai-fab-btn')) {
    const launcher = document.createElement('button');
    launcher.id = 'ai-fab-btn';
    launcher.type = 'button';
    launcher.title = 'Open AI Co-Pilot';
    launcher.textContent = '✦ AI';
    launcher.style.cssText = 'position:fixed;right:18px;bottom:20px;z-index:9998;border:0;border-radius:999px;padding:12px 15px;background:linear-gradient(135deg,#9b59b6,#3498db);color:#fff;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.3);cursor:pointer';
    launcher.onclick = window.openAICoPilot;
    document.body.appendChild(launcher);
  }
})();
