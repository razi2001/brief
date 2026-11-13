  // ---- the popup and the account's tracker status (/api/me) ----
  // Every Brief Cloud call from the extension is answered here (nothing leaves
  // the machine); /api/me says whatever the current case needs.
  const shot = async (sid, name) => fs.writeFileSync(`${SCRATCH}/${name}`, Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, sid)).data, 'base64'));
  const APP = 'https://cloud.get-brief.app';
  let me = {};
  let meDelayMs = 0;
  // What the worker sent when a brief was created and drafted (Public link,
  // Fix prompt): the create hands back upload urls on this same origin.
  const calls = [];
  const answer = async (sid, p) => {
    const url = p.request.url;
    const isMe = url.endsWith('/api/me');
    if (isMe && meDelayMs) await sleep(meDelayMs);
    let body = isMe ? me : { ok: true };
    if (p.request.method === 'POST' && /\/api\/briefs$/.test(url)) {
      const req = JSON.parse(p.request.postData || '{}');
      calls.push({ what: 'create', body: req });
      body = { briefId: 'b-e2e', uploads: Object.fromEntries((req.files || []).map((f) => [f, { path: f, token: 't', signedUrl: `${APP}/upload/${f}` }])) };
    } else if (/\/api\/briefs\/[^/]+\/draft$/.test(url)) {
      const req = JSON.parse(p.request.postData || '{}');
      calls.push({ what: 'draft', body: req });
      body = { queued: true, shareId: req.shareId };
    } else if (/\/api\/briefs\/[^/]+\/process$/.test(url)) {
      const req = JSON.parse(p.request.postData || '{}');
      calls.push({ what: 'process', body: req });
      body = { queued: true, shareId: 'sharesharesh' };
    }
    await b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }, sid).catch(() => {});
  };
  const watch = async (sid) => b.send('Fetch.enable', { patterns: [{ urlPattern: APP + '/*' }] }, sid).catch(() => {});
  b.on((m) => {
    if (m.method === 'Fetch.requestPaused') answer(m.sessionId, m.params);
    if (m.method === 'Target.attachedToTarget') {
      const sid = m.params.sessionId;
      watch(sid).then(() => b.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {}));
    }
  });
  await b.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  // A paired account and a brief ready to file.
  const reset = (cache) => W(`chrome.storage.local.remove(['bcTrackerCache', 'createDefault', 'fixAgent']).then(() => chrome.storage.local.set({
    briefCloudToken: 'bxt_test',
    draft: { id: 'd-status', createdAt: Date.now(), screenshots: [], description: 'the Pay button does nothing' },
    ${cache ? `bcTrackerCache: ${JSON.stringify(cache)},` : ''}
  }))`);
  const popupState = (sid) => evalIn(sid, `(() => {
    const r = document.querySelector('#reconnectBtn');
    const c = document.querySelector('#createBtn');
    return { shown: !!r && !r.hidden && r.offsetParent !== null, label: r ? r.textContent.trim() : null, createDisabled: c.disabled, err: document.querySelector('#errBar').textContent };
  })()`);

  // A Linear still held by Clerk, with Brief's own Linear app live.
  me = { ok: true, tracker: 'linear', trackerName: 'Linear', trackerIssue: null, trackerAction: 'reconnect' };
  await reset(null);
  const P1 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const s1 = await popupState(P1.sid);
  check('a tracker still on Clerk: the popup offers "Reconnect Linear"', s1.shown && s1.label === 'Reconnect Linear', JSON.stringify(s1));
  check('Create ticket stays enabled beside it', s1.createDisabled === false, JSON.stringify(s1));
  const cached = await W(`chrome.storage.local.get('bcTrackerCache').then((r) => r.bcTrackerCache)`);
  check('the action is cached with the tracker', cached?.trackerAction === 'reconnect' && cached?.tracker === 'linear', JSON.stringify(cached));
  await shot(P1.sid, 'popup-reconnect.png');

  // Clicking it asks for Connections' tracker row. Tab opening is recorded, not
  // done, so no page loads from the real app.
  await evalIn(P1.sid, `(() => {
    chrome.tabs.query = async () => [];
    chrome.tabs.create = async (o) => { await chrome.storage.local.set({ __opened: o.url }); return {}; };
    window.close = () => {};
  })()`);
  await click(P1.sid, '#reconnectBtn'); await sleep(500);
  const opened = await W(`chrome.storage.local.get('__opened').then((r) => r.__opened)`);
  check('it opens Connections on the tracker row', opened === `${APP}/connections#tracker`, JSON.stringify(opened));
  await b.send('Target.closeTarget', { targetId: P1.targetId }).catch(() => {});

  // Moved to Brief since: the next open paints the row from the cache while
  // /api/me is slow, and drops it once the server stops asking.
  me = { ok: true, tracker: 'linear', trackerName: 'Linear', trackerIssue: null, trackerAction: null };
  meDelayMs = 2500;
  const P2 = await open(`chrome-extension://${extId}/popup.html`); await sleep(900);
  const s2 = await popupState(P2.sid);
  check('the next open shows it from the cache, before /api/me answers', s2.shown && s2.label === 'Reconnect Linear', JSON.stringify(s2));
  await sleep(3000);
  const s3 = await popupState(P2.sid);
  check('once Brief holds the tracker, the row goes and Create stays enabled', !s3.shown && s3.createDisabled === false, JSON.stringify(s3));
  meDelayMs = 0;
  await b.send('Target.closeTarget', { targetId: P2.targetId }).catch(() => {});

  // A cache from before trackerAction existed, and a server that doesn't send it.
  me = { ok: true, tracker: 'linear', trackerName: 'Linear', trackerIssue: null };
  await reset({ tracker: 'linear' });
  const P4 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const s4 = await popupState(P4.sid);
  check('an old cache and an older server: no row, Create enabled', !s4.shown && s4.createDisabled === false, JSON.stringify(s4));
  await b.send('Target.closeTarget', { targetId: P4.targetId }).catch(() => {});

  // No tracker that can file: the button saves drafts, and the menu's ticket
  // row carries the fix as a pill (Connect, Reconnect, Finish), which opens
  // Connections' tracker row.
  const createState = (sid) => evalIn(sid, `(() => {
    const c = document.querySelector('#createBtn');
    const r = document.querySelector('#reconnectBtn');
    const m = document.querySelector('#createMenuBtn');
    const fix = document.querySelector('.cm-item[data-key="fix"]');
    return { label: c.textContent.trim(), disabled: c.disabled, row: !!r && !r.hidden && r.offsetParent !== null, dot: m.classList.contains('attn'),
      fix: fix ? fix.querySelector('.cm-t').textContent : null, pill: fix?.querySelector('.cm-pill')?.textContent || null, err: document.querySelector('#errBar').textContent };
  })()`);
  const fixes = [
    ['an expired Linear', { trackerName: 'Linear', trackerIssue: 'Your Linear connection has expired - reconnect it under Settings, then retry.', trackerAction: 'reconnect' }, ['Create in Linear', 'Reconnect'], 'popup-fix-reconnect.png'],
    ['a pick still to make', { trackerName: 'Azure DevOps', trackerIssue: 'Pick your Azure DevOps organization under Settings, then retry.', trackerAction: 'pick' }, ['Create in Azure DevOps', 'Finish'], 'popup-fix-pick.png'],
    ['nothing connected', { trackerName: null, trackerIssue: null, trackerAction: 'connect' }, ['Create ticket', 'Connect'], 'popup-fix-connect.png'],
    ['an older server that sends no action', { trackerName: null, trackerIssue: null }, ['Create ticket', 'Connect'], null],
  ];
  for (const [what, status, [rowTitle, label], png] of fixes) {
    me = { ok: true, tracker: null, ...status };
    await reset({ tracker: null });
    const P = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
    const st = await createState(P.sid);
    check(`${what}: Create saves a draft; the menu's "${rowTitle}" row offers "${label}"`, !st.row && !st.dot && st.fix === rowTitle && st.pill === label && st.label === 'Share link' && !st.disabled, JSON.stringify(st));
    await evalIn(P.sid, `(() => {
      chrome.tabs.query = async () => [];
      chrome.tabs.create = async (o) => { await chrome.storage.local.set({ __opened: o.url }); return {}; };
      window.close = () => {};
    })()`);
    await W(`chrome.storage.local.remove('__opened')`);
    await click(P.sid, '#createMenuBtn'); await sleep(300);
    if (png) await shot(P.sid, png);
    await click(P.sid, '.cm-item[data-key="fix"] .cm-pill'); await sleep(500);
    const went = await W(`chrome.storage.local.get('__opened').then((r) => r.__opened)`);
    const after = await createState(P.sid);
    check(`${what}: the fix opens Connections' tracker row and shows no error`, went === `${APP}/connections#tracker` && after.err === '', JSON.stringify({ went, err: after.err }));
    await b.send('Target.closeTarget', { targetId: P.targetId }).catch(() => {});
  }

  // The next open paints the fix from the cache, before /api/me answers.
  me = { ok: true, tracker: null, trackerName: 'Linear', trackerIssue: null, trackerAction: 'reconnect' };
  await reset({ tracker: null, trackerName: 'Linear', trackerAction: 'reconnect' });
  meDelayMs = 2500;
  const P6 = await open(`chrome-extension://${extId}/popup.html`); await sleep(900);
  const s6 = await createState(P6.sid);
  check('a cached fix shows before /api/me answers', s6.fix === 'Create in Linear' && s6.pill === 'Reconnect' && s6.label === 'Share link', JSON.stringify(s6));
  meDelayMs = 0;
  await b.send('Target.closeTarget', { targetId: P6.targetId }).catch(() => {});

  // One button and its menu: the pick (Create in <tracker>, Share link, Fix
  // prompt) becomes the button, and is remembered.
  const menuState = (sid) => evalIn(sid, `(() => {
    const m = document.querySelector('#createMenu');
    return { open: m.classList.contains('open') && getComputedStyle(m).visibility === 'visible',
      items: [...m.querySelectorAll('.cm-item')].map((i) => ({ key: i.dataset.key, t: i.querySelector('.cm-t').textContent, on: i.getAttribute('aria-checked') === 'true' })),
      button: document.querySelector('#createBtn').textContent.trim() };
  })()`);
  const stubCopy = (sid) => evalIn(sid, `(() => {
    navigator.clipboard.writeText = async (t) => { await chrome.storage.local.set({ __copied: t }); };
    // the page the popup sits on, for app links; no Brief tab already open
    chrome.tabs.query = async (q) => (q && q.active ? [{ id: 7, url: 'https://shop.test/checkout' }] : []);
    chrome.tabs.create = async (o) => { await chrome.storage.local.set({ __opened: o.url }); return {}; };
    // an app link (codex://...) goes through the page: note it, don't follow it
    chrome.tabs.update = async (id, o) => { await chrome.storage.local.set({ [/^https?:/.test(o.url) ? '__opened' : '__launched']: o.url, __launchedVia: id }); return {}; };
    HTMLAnchorElement.prototype.click = function () { chrome.storage.local.set({ __launched: this.href, __launchedVia: 'popup' }); };
    window.close = () => {};
  })()`);
  const stored = (key) => W(`chrome.storage.local.get('${key}').then((r) => r['${key}'] || '')`);
  const pickAgent = async (sid, agent) => {
    await click(sid, '#createMenuBtn'); await sleep(300);
    await click(sid, '.cm-item[data-key="prompt"]'); await sleep(500);
    const offered = await evalIn(sid, `[...document.querySelectorAll('#sheetBody [data-agent]')].map((b) => b.dataset.agent).join()`);
    await click(sid, `[data-agent="${agent}"]`); await sleep(500);
    return offered;
  };
  const copiedText = () => W(`chrome.storage.local.get('__copied').then((r) => r.__copied || '')`);
  const shareIdsSent = () => calls.map((c) => ({ what: c.what, shareId: c.body.shareId }));
  const pick = async (sid, key) => { await click(sid, '#createMenuBtn'); await sleep(300); await click(sid, `.cm-item[data-key="${key}"]`); await sleep(300); };

  me = { ok: true, tracker: 'linear', trackerName: 'Linear', trackerIssue: null, trackerAction: null };
  await reset({ tracker: 'linear', trackerName: 'Linear' });
  let P7 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const m0 = await menuState(P7.sid);
  check('with a tracker the button reads "Create in Linear"', m0.button === 'Create in Linear' && !m0.open, JSON.stringify(m0));
  await click(P7.sid, '#createMenuBtn'); await sleep(300);
  const m1 = await menuState(P7.sid);
  check('its menu offers the tracker, the draft and the prompt, the tracker ticked',
    m1.open && m1.items.map((i) => i.key).join() === 'ticket,draft,prompt' && m1.items[0].t === 'Create in Linear' && m1.items[0].on, JSON.stringify(m1));
  await shot(P7.sid, 'popup-create-menu.png');
  await click(P7.sid, '.cm-item[data-key="draft"]'); await sleep(300);
  const m2 = await menuState(P7.sid);
  const saved = await W(`chrome.storage.local.get('createDefault').then((r) => r.createDefault)`);
  check('picking Share link makes it the button, and it is remembered', !m2.open && m2.button === 'Share link' && saved === 'draft', JSON.stringify({ m2, saved }));
  await shot(P7.sid, 'popup-ctas.png');
  await b.send('Target.closeTarget', { targetId: P7.targetId }).catch(() => {});

  P7 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const m3 = await menuState(P7.sid);
  check('the next open is still on Share link', m3.button === 'Share link', JSON.stringify(m3));
  await stubCopy(P7.sid);
  calls.length = 0;
  await click(P7.sid, '#createBtn'); await sleep(2500);
  const link = await copiedText();
  const linkId = link.match(/^https:\/\/cloud\.get-brief\.app\/b\/([A-Za-z0-9_-]{12})$/)?.[1];
  check('Share link copies the brief page link on click', !!linkId, JSON.stringify(link));
  check('the brief is created with that link and drafted with it',
    calls.find((c) => c.what === 'create')?.body.shareId === linkId && calls.find((c) => c.what === 'draft')?.body.shareId === linkId, JSON.stringify(shareIdsSent()));
  const t7 = await evalIn(P7.sid, `(() => { const t = document.querySelector('#toast'); return { text: t.textContent, check: !!t.querySelector('svg'), oneLine: t.getBoundingClientRect().height < 40 }; })()`);
  check('it says "Link copied", on one line with a check', t7.text === 'Link copied' && t7.check && t7.oneLine, JSON.stringify(t7));

  // A new brief, then Fix prompt: picking it asks which agent, once; the
  // button then copies the prompt and opens that agent with it.
  await W(`chrome.storage.local.set({ __copied: '', __launched: '', __opened: '', draft: { id: 'd-prompt', createdAt: Date.now(), screenshots: [], description: '  the Pay button does nothing\\nsecond line' } })`);
  await sleep(800);
  const offered = await pickAgent(P7.sid, 'codex');
  check('picking Fix prompt asks which agent', offered === 'claude,codex,cursor,vscode,copy', offered);
  const mc = await menuState(P7.sid);
  check('Codex makes the button "Fix in Codex", and it is remembered', mc.button === 'Fix in Codex' && (await stored('fixAgent')) === 'codex' && (await stored('createDefault')) === 'prompt', JSON.stringify(mc));
  calls.length = 0;
  await click(P7.sid, '#createBtn'); await sleep(2500);
  const prompt = await copiedText();
  const promptId = prompt.match(/https:\/\/cloud\.get-brief\.app\/b\/([A-Za-z0-9_-]{12})\.md/)?.[1];
  check('Fix prompt copies the bug in the reporter\'s words', prompt.startsWith('Fix this bug: the Pay button does nothing\n\n'), JSON.stringify(prompt));
  check('and points the agent at the report as Markdown, the same link the brief is drafted with',
    !!promptId && calls.find((c) => c.what === 'draft')?.body.shareId === promptId, JSON.stringify({ prompt, sent: shareIdsSent() }));
  check('and asks for a ticket assigned to the reader, a PR sent back, and "Here is the fix" on the ticket or in the chat',
    prompt.includes('create a ticket for it in our tracker and assign it to me') && prompt.includes('open a PR and send me the link')
      && prompt.includes('comment "Here is the fix" with the PR link on the ticket, or here if there is no ticket'), JSON.stringify(prompt));
  const launched = await stored('__launched');
  check('and opens Codex with that prompt filled in, through the page (not the popup)', launched === `codex://new?prompt=${encodeURIComponent(prompt)}` && (await stored('__launchedVia')) === 7, launched.slice(0, 120));
  const t8 = await evalIn(P7.sid, `document.querySelector('#toast').textContent`);
  check('it says "Prompt copied, opening Codex"', t8 === 'Prompt copied, opening Codex', t8);

  // Claude Code: the Claude desktop app's Code tab, no browser tab.
  await W(`chrome.storage.local.set({ __copied: '', __launched: '', __opened: '', draft: { id: 'd-claude', createdAt: Date.now(), screenshots: [], description: 'checkout hangs' } })`);
  await sleep(800);
  await pickAgent(P7.sid, 'claude');
  const mcl = await menuState(P7.sid);
  check('Claude Code makes the button "Fix in Claude Code"', mcl.button === 'Fix in Claude Code', JSON.stringify(mcl));
  await click(P7.sid, '#createBtn'); await sleep(2500);
  const prompt2 = await copiedText();
  const launchedClaude = await stored('__launched');
  check("and opens the Claude app's Code tab with the prompt filled in", !!prompt2 && launchedClaude === `claude://code/new?q=${encodeURIComponent(prompt2)}` && !(await stored('__opened')), launchedClaude.slice(0, 120));

  // Just copy: the plain label, nothing opened.
  await W(`chrome.storage.local.set({ __copied: '', __launched: '', __opened: '', draft: { id: 'd-copy', createdAt: Date.now(), screenshots: [], description: 'cart empties' } })`);
  await sleep(800);
  await pickAgent(P7.sid, 'copy');
  const mcp = await menuState(P7.sid);
  await click(P7.sid, '#createBtn'); await sleep(2500);
  check('Just copy: "Fix prompt", copies, opens nothing',
    mcp.button === 'Fix prompt' && !!(await copiedText()) && !(await stored('__launched')) && !(await stored('__opened')), JSON.stringify(mcp));
  await b.send('Target.closeTarget', { targetId: P7.targetId }).catch(() => {});

  // Fix prompt picked before any agent was: the first click asks, then goes.
  await reset({ tracker: 'linear', trackerName: 'Linear' });
  await W(`chrome.storage.local.set({ createDefault: 'prompt', __copied: '', __launched: '', __opened: '' })`);
  const P9 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  await stubCopy(P9.sid);
  const before = await menuState(P9.sid);
  await click(P9.sid, '#createBtn'); await sleep(600);
  const asked = await evalIn(P9.sid, `!!document.querySelector('#sheet.open [data-agent]')`);
  check('with no agent yet, the first click asks first and copies nothing', before.button === 'Fix prompt' && asked && !(await copiedText()), JSON.stringify({ before, asked }));
  await click(P9.sid, '[data-agent="cursor"]'); await sleep(2500);
  const launched9 = await stored('__launched');
  check('picking Cursor then copies and opens Cursor', !!(await copiedText()) && launched9.startsWith('cursor://anysphere.cursor-deeplink/prompt?text='), launched9.slice(0, 80));
  await b.send('Target.closeTarget', { targetId: P9.targetId }).catch(() => {});

  // No tracker: the button saves drafts whatever was picked, and the menu's
  // first item is the fix, which opens Connections.
  me = { ok: true, tracker: null, trackerName: null, trackerIssue: null, trackerAction: 'connect' };
  await reset({ tracker: null });
  const P8 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  await stubCopy(P8.sid);
  await click(P8.sid, '#createMenuBtn'); await sleep(300);
  const m8 = await menuState(P8.sid);
  check('with no tracker: the button saves a draft, the menu leads with the fix',
    m8.button === 'Share link' && m8.items[0].key === 'fix' && m8.items[0].t === 'Create ticket' && m8.items[1].on, JSON.stringify(m8));
  await shot(P8.sid, 'popup-ctas-no-tracker.png');
  await W(`chrome.storage.local.remove('__opened')`);
  await click(P8.sid, '.cm-item[data-key="fix"]'); await sleep(500);
  const went8 = await W(`chrome.storage.local.get('__opened').then((r) => r.__opened)`);
  check('the fix in the menu opens Connections\' tracker row', went8 === `${APP}/connections#tracker`, JSON.stringify(went8));
  await b.send('Target.closeTarget', { targetId: P8.targetId }).catch(() => {});

  // No microphone: the popup opens like any other, and a screenshot works. The
  // browser's fake media UI hands out the mic whatever the permission says, so
  // the popup's getUserMedia fails the way a denied mic does, from before its
  // scripts run. It sits in a background tab: the test page is the tab in
  // front, the one a screenshot takes.
  me = { ok: true, tracker: 'linear', trackerName: 'Linear', trackerIssue: null, trackerAction: null };
  await reset({ tracker: 'linear', trackerName: 'Linear' });
  await W(`chrome.storage.local.remove(['micGrantedAt', 'createDefault'])`);
  const site = await open(`http://localhost:${WEB}/`); await focus(site);
  const { targetId: noMicT } = await b.send('Target.createTarget', { url: 'about:blank', background: true });
  const PM = { targetId: noMicT, sid: await attach(noMicT) };
  await b.send('Runtime.enable', {}, PM.sid); await b.send('Page.enable', {}, PM.sid);
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));` }, PM.sid);
  await b.send('Page.navigate', { url: `chrome-extension://${extId}/popup.html` }, PM.sid);
  await sleep(2000);
  const after = (await b.send('Target.getTargets')).targetInfos;
  const open1 = after.some((t) => t.targetId === noMicT);
  const mic = open1 ? await evalIn(PM.sid, `navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return 'granted'; }, (e) => e.name)`) : null;
  const pm = open1 ? await evalIn(PM.sid, `({ ready: document.body.classList.contains('ready'), button: document.querySelector('#createBtn').textContent.trim() })`) : null;
  const setupTabs = after.filter((t) => t.url.includes('/permission.html')).length;
  check('mic denied: the popup opens as usual, no setup tab',
    open1 && mic === 'NotAllowedError' && pm.ready && pm.button === 'Create in Linear' && setupTabs === 0,
    JSON.stringify({ open: open1, mic, pm, setupTabs }));
  if (!open1) throw new Error('the popup closed itself');
  await evalIn(PM.sid, `window.close = () => {}; document.querySelector('[data-add]').click()`); await sleep(400);
  await evalIn(PM.sid, `document.querySelector('#chShot').click()`); await sleep(1500);
  const annotator = await evalIn(site.sid, `!!document.getElementById('__brief_shot__')`);
  const shotErr = await evalIn(PM.sid, `document.querySelector('#errBar').textContent`);
  check('mic denied: Screenshot captures the page and opens the annotator on it', annotator && !shotErr, JSON.stringify({ annotator, shotErr }));
  await b.send('Target.closeTarget', { targetId: noMicT }).catch(() => {});
  await b.send('Target.closeTarget', { targetId: site.targetId }).catch(() => {});

  // ---- your time is running in a bug bash: a row above Create, with a timer and a switch ----
  const bashState = (sid) => evalIn(sid, `(() => {
    const r = document.querySelector('#bashRow');
    const sw = document.querySelector('#bashSwitch');
    const c = document.querySelector('#createBtn');
    return { shown: !!r && !r.hidden && r.offsetParent !== null, name: document.querySelector('#bashName').textContent, timer: document.querySelector('#bashTimer').textContent,
      on: sw.getAttribute('aria-checked') === 'true', quiet: r.classList.contains('off'), button: c.textContent.replace(/\\s+/g, ' ').trim(), disabled: c.disabled };
  })()`);
  const menuRows = (sid) => evalIn(sid, `[...document.querySelectorAll('#createMenu .cm-item')].map((i) => ({ key: i.dataset.key, t: i.querySelector('.cm-t').textContent, s: i.querySelector('.cm-s').textContent, on: i.getAttribute('aria-checked') === 'true' }))`);
  const toastText = (sid) => evalIn(sid, `document.querySelector('#toast').textContent`);
  const secs = (t) => t.split(':').reduce((n, x) => n * 60 + Number(x), 0);
  const noBash = { ok: true, tracker: 'linear', trackerName: 'Linear', trackerIssue: null, trackerAction: null };
  const MIN = 60_000;
  const held = (leftMs = 72 * MIN) => ({ name: 'Release 2.4', hold: true, leftMs });
  const start = async (cache) => { await reset(cache); await W(`chrome.storage.local.set({ createDefault: 'ticket' })`); };

  // In none: the popup is as it always was.
  me = { ...noBash, bash: null };
  await start(null);
  const B0 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const b0 = await bashState(B0.sid);
  check('in no bug bash: no row, Create as usual', !b0.shown && b0.button === 'Create in Linear', JSON.stringify(b0));
  await b.send('Target.closeTarget', { targetId: B0.targetId }).catch(() => {});

  // Your time is running in one that holds its reports for a review.
  me = { ...noBash, bash: held() };
  await start(null);
  const B1 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const b1 = await bashState(B1.sid);
  check('your time is running: the bug bash shows above Create, switched on', b1.shown && b1.name === 'Release 2.4' && b1.on && !b1.quiet, JSON.stringify(b1));
  check('with the time you have left', /^1:1[01]:\d\d$/.test(b1.timer), JSON.stringify(b1.timer));
  await sleep(2200);
  const b1later = await bashState(B1.sid);
  check('which counts down', secs(b1later.timer) < secs(b1.timer) && secs(b1.timer) - secs(b1later.timer) <= 4, JSON.stringify([b1.timer, b1later.timer]));
  check('one that holds: the button reads "Add to <its name>"', b1.button === 'Add to Release 2.4' && !b1.disabled, JSON.stringify(b1));
  await click(B1.sid, '#createMenuBtn'); await sleep(300);
  const rows1 = await menuRows(B1.sid);
  check('the menu keeps its three lines, the first saying it is held', rows1.map((r) => r.key).join() === 'ticket,draft,prompt' && rows1[0].t === 'Add to Release 2.4' && rows1[0].s === 'Held for the bug bash review', JSON.stringify(rows1));
  await evalIn(B1.sid, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(300);
  await shot(B1.sid, 'popup-bug-bash.png');
  const cachedBash = await W(`chrome.storage.local.get('bcTrackerCache').then((r) => r.bcTrackerCache)`);
  check('the bug bash is cached with the tracker, with when your time ends', cachedBash?.bash?.name === 'Release 2.4' && cachedBash?.bash?.hold === true && cachedBash?.bash?.endsAt > Date.now() + 60 * MIN, JSON.stringify(cachedBash));

  // Sent with the switch on: for the bug bash.
  await stubCopy(B1.sid);
  calls.length = 0;
  await click(B1.sid, '#createBtn'); await sleep(2500);
  const sentOn = calls.find((c) => c.what === 'process');
  check('sent with the switch on: the ticket ask carries no opt-out', !!sentOn && !('bash' in sentOn.body), JSON.stringify(calls.map((c) => ({ what: c.what, bash: c.body.bash }))));
  const tOn = await toastText(B1.sid);
  check('it says "Added to Release 2.4"', tOn === 'Added to Release 2.4', JSON.stringify(tOn));
  const fresh = await bashState(B1.sid);
  check('the next brief starts with the switch on again', fresh.shown && fresh.on && fresh.button === 'Add to Release 2.4', JSON.stringify(fresh));
  await b.send('Target.closeTarget', { targetId: B1.targetId }).catch(() => {});

  // Switched off for one brief: it is sent as if in no bug bash.
  await start({ tracker: 'linear', trackerName: 'Linear', bash: { name: 'Release 2.4', hold: true, endsAt: Date.now() + 70 * MIN } });
  meDelayMs = 2500;
  const B2 = await open(`chrome-extension://${extId}/popup.html`); await sleep(900);
  const early = await bashState(B2.sid);
  check('the next open shows the bug bash from the cache, timer running, before /api/me answers', early.shown && early.button === 'Add to Release 2.4' && /^1:(10:00|09:\d\d)$/.test(early.timer), JSON.stringify(early));
  await sleep(2600); meDelayMs = 0;
  await click(B2.sid, '#bashSwitch'); await sleep(500);
  const b2 = await bashState(B2.sid);
  check('switched off: the row goes quiet and the button is "Create in Linear" again', b2.shown && !b2.on && b2.quiet && b2.button === 'Create in Linear', JSON.stringify(b2));
  const kept = await W(`chrome.storage.local.get('draft').then((r) => r.draft?.bashOff)`);
  check('the choice is kept on the brief', kept === true, JSON.stringify(kept));
  await b.send('Target.closeTarget', { targetId: B2.targetId }).catch(() => {});
  const B3 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const b3 = await bashState(B3.sid);
  check('and is still off when the popup is opened again', b3.shown && !b3.on && b3.button === 'Create in Linear', JSON.stringify(b3));
  await stubCopy(B3.sid);
  calls.length = 0;
  await click(B3.sid, '#createBtn'); await sleep(2500);
  const sentOff = calls.find((c) => c.what === 'process');
  check('sent with the switch off: the ticket ask says to leave the bug bash out', sentOff?.body.bash === false, JSON.stringify(calls.map((c) => ({ what: c.what, bash: c.body.bash }))));
  const tOff = await toastText(B3.sid);
  check('and it says "Ticket queued"', tOff === 'Ticket queued', JSON.stringify(tOff));
  const afterOff = await bashState(B3.sid);
  check('the brief after that one has the switch on again', afterOff.on && afterOff.button === 'Add to Release 2.4', JSON.stringify(afterOff));
  // ...and back on by hand
  await click(B3.sid, '#bashSwitch'); await sleep(400);
  await click(B3.sid, '#bashSwitch'); await sleep(400);
  const backOn = await bashState(B3.sid);
  check('off then on again: the button follows', backOn.on && !backOn.quiet && backOn.button === 'Add to Release 2.4', JSON.stringify(backOn));
  await b.send('Target.closeTarget', { targetId: B3.targetId }).catch(() => {});

  // A link shared with the switch on counts for the bug bash; off, it does not.
  await start(null);
  const B3c = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  await pick(B3c.sid, 'draft');
  await stubCopy(B3c.sid);
  calls.length = 0;
  await click(B3c.sid, '#createBtn'); await sleep(2500);
  const linkOn = calls.find((c) => c.what === 'draft');
  check('Share link with the switch on: no opt-out, so it counts', !!linkOn && !('bash' in linkOn.body), JSON.stringify(calls.map((c) => ({ what: c.what, bash: c.body.bash }))));
  await b.send('Target.closeTarget', { targetId: B3c.targetId }).catch(() => {});
  await W(`chrome.storage.local.set({ draft: { id: 'd-link-off', createdAt: Date.now(), screenshots: [], description: 'checkout hangs', bashOff: true } })`);
  const B3d = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  await stubCopy(B3d.sid);
  calls.length = 0;
  await click(B3d.sid, '#createBtn'); await sleep(2500);
  const linkOff = calls.find((c) => c.what === 'draft');
  check('Share link with the switch off: it leaves the bug bash out', linkOff?.body.bash === false, JSON.stringify(calls.map((c) => ({ what: c.what, bash: c.body.bash }))));
  await b.send('Target.closeTarget', { targetId: B3d.targetId }).catch(() => {});
  await W(`chrome.storage.local.set({ createDefault: 'ticket' })`);

  // No tracker at all: a bug bash that holds needs none.
  me = { ok: true, tracker: null, trackerName: null, trackerIssue: null, trackerAction: 'connect', bash: held() };
  await start(null);
  const B4 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const b4 = await bashState(B4.sid);
  check('with no tracker, one that holds still takes the brief', b4.button === 'Add to Release 2.4' && !b4.disabled, JSON.stringify(b4));
  await click(B4.sid, '#bashSwitch'); await sleep(500);
  const b4off = await bashState(B4.sid);
  check('switched off there, the button falls back to sharing a link', b4off.button === 'Share link', JSON.stringify(b4off));
  await b.send('Target.closeTarget', { targetId: B4.targetId }).catch(() => {});

  // One that doesn't hold: the ticket is filed as usual (the server adds the label).
  me = { ...noBash, bash: { name: 'Checkout', hold: false, leftMs: 20 * MIN } };
  await start(null);
  const B5 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const b5 = await bashState(B5.sid);
  await click(B5.sid, '#createMenuBtn'); await sleep(300);
  const rows5 = await menuRows(B5.sid);
  check('one that does not hold: the row shows, the button still files to the tracker, the menu says with the label',
    b5.shown && b5.on && b5.button === 'Create in Linear' && /^(19|20):\d\d$/.test(b5.timer) && rows5[0].s === 'Filed now, with the bug bash label', JSON.stringify({ b5, rows5 }));
  await evalIn(B5.sid, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(300);
  await stubCopy(B5.sid);
  await click(B5.sid, '#createBtn'); await sleep(2500);
  const t5 = await toastText(B5.sid);
  check('and its toast still says it went to the bug bash', t5 === 'Added to Checkout', JSON.stringify(t5));
  await b.send('Target.closeTarget', { targetId: B5.targetId }).catch(() => {});

  // Your time runs out while the popup is open: the row goes on its own.
  me = { ...noBash, bash: held(3500) };
  await start(null);
  const B6 = await open(`chrome-extension://${extId}/popup.html`); await sleep(1800);
  const last = await bashState(B6.sid);
  me = { ...noBash, bash: null };
  await sleep(3200);
  const gone = await bashState(B6.sid);
  check('when your time runs out the row goes and the button is "Create in Linear" again', last.shown && /^0:0\d$/.test(last.timer) && !gone.shown && gone.button === 'Create in Linear', JSON.stringify({ last, gone }));
  await b.send('Target.closeTarget', { targetId: B6.targetId }).catch(() => {});
  const B6b = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const b6b = await bashState(B6b.sid);
  check('and it is not brought back from the cache on the next open', !b6b.shown && b6b.button === 'Create in Linear', JSON.stringify(b6b));
  await b.send('Target.closeTarget', { targetId: B6b.targetId }).catch(() => {});

  // A server from before the timer (no time left sent): no row, nothing breaks.
  me = { ...noBash, bash: { name: 'Release 2.4', hold: true } };
  await start(null);
  const B6c = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const b6c = await bashState(B6c.sid);
  check('a bug bash sent with no time left is not shown', !b6c.shown && b6c.button === 'Create in Linear', JSON.stringify(b6c));
  await b.send('Target.closeTarget', { targetId: B6c.targetId }).catch(() => {});

  // A long name is cut, in the row and in the button; both stay one line.
  me = { ...noBash, bash: { name: 'Release 2.4 checkout and payments regression for the whole team', hold: true, leftMs: 170 * MIN } };
  await start(null);
  const B7 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const fit = await evalIn(B7.sid, `(() => { const r = document.querySelector('#bashRow').getBoundingClientRect(); const n = document.querySelector('#bashName'); const c = document.querySelector('#createBtn'); const cn = c.querySelector('.ctk-name'); return { row: Math.round(r.width), rowH: Math.round(r.height), cut: n.scrollWidth > n.clientWidth, split: Math.round(document.querySelector('#createSplit').getBoundingClientRect().width), btnH: Math.round(c.getBoundingClientRect().height), btnCut: cn.scrollWidth > cn.clientWidth, timer: document.querySelector('#bashTimer').textContent }; })()`);
  check('a long name is cut in the row and in the button, each on one line', fit.row <= 360 && fit.rowH < 60 && fit.cut && fit.split <= 360 && fit.btnH < 60 && fit.btnCut && /^2:\d\d:\d\d$/.test(fit.timer), JSON.stringify(fit));
  await shot(B7.sid, 'popup-bug-bash-long.png');
  await b.send('Target.closeTarget', { targetId: B7.targetId }).catch(() => {});

  // What the voice said shows under the tiles (it goes into the ticket); with
  // no words heard the tile says "No voice". Both open the transcript.
  const footOf = (sid) => evalIn(sid, `(() => {
    const f = document.querySelector('.tile.rec .rec-foot');
    const v = document.querySelector('.voice-line');
    const g = document.querySelector('#gallery').getBoundingClientRect();
    return { cls: f.className, text: f.textContent.trim(), footH: Math.round(f.getBoundingClientRect().height),
      line: v ? v.textContent.trim() : null, lineW: v ? Math.round(v.getBoundingClientRect().width) : 0, lineH: v ? Math.round(v.getBoundingClientRect().height) : 0, galleryW: Math.round(g.width) };
  })()`);
  const withRecording = async (extra) => {
    await W(`chrome.storage.local.set({ draft: { id: 'd-voice', createdAt: Date.now(), screenshots: [], description: '', recording: { recordedAt: Date.now(), durationMs: 42000 }, ...${JSON.stringify(extra)} } })`);
    const P = await open(`chrome-extension://${extId}/popup.html`); await sleep(1500);
    return P;
  };
  const onTranscript = (sid) => evalIn(sid, `document.activeElement?.id === 'recTranscript' && !!document.querySelector('#sheet.open')`);
  const PV = await withRecording({ transcript: 'The total does not update when I add a coupon, it stays at forty euros' });
  const fv = await footOf(PV.sid);
  check('a narrated recording: its words show on one full-width line under the tiles', fv.line === '“The total does not update when I add a coupon, it stays at forty euros”' && fv.lineW === fv.galleryW && fv.lineH < 22 && fv.text === 'Recording 0:42', JSON.stringify(fv));
  await shot(PV.sid, 'popup-tile-voice.png');
  await click(PV.sid, '.voice-line'); await sleep(600);
  check('clicking the line opens the recording on its transcript', (await onTranscript(PV.sid)) === true);
  await b.send('Target.closeTarget', { targetId: PV.targetId }).catch(() => {});

  const PN = await withRecording({ transcript: '', noSpeech: true });
  const fn = await footOf(PN.sid);
  check('no words heard: the tile says "No voice" on one line, and there is no line under it', fn.cls === 'rec-foot novoice' && fn.text === 'No voice' && fn.footH < 26 && fn.line === null, JSON.stringify(fn));
  await shot(PN.sid, 'popup-tile-novoice.png');
  await click(PN.sid, '.tile.rec .rec-foot'); await sleep(600);
  check('clicking it opens the recording on its transcript, ready to type', (await onTranscript(PN.sid)) === true);
  await evalIn(PN.sid, `(() => { const t = document.querySelector('#recTranscript'); t.value = 'Typed after the fact'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(700);
  const ft = await footOf(PN.sid);
  check('words typed there show on the line, and the tile stops saying "No voice"', ft.line === '“Typed after the fact”' && ft.text === 'Recording 0:42', JSON.stringify(ft));
  await b.send('Target.closeTarget', { targetId: PN.targetId }).catch(() => {});

  const PT = await withRecording({ transcript: '', transcribing: true });
  const ftr = await footOf(PT.sid);
  check('while it transcribes the tile still says "Transcribing"', ftr.text === 'Transcribing' && ftr.line === null, JSON.stringify(ftr));
  await b.send('Target.closeTarget', { targetId: PT.targetId }).catch(() => {});

  const PO = await withRecording({ transcript: '' });
  const fo = await footOf(PO.sid);
  check('a recording never transcribed keeps "Recording 0:42" (not "No voice")', fo.text === 'Recording 0:42' && fo.line === null, JSON.stringify(fo));
  await b.send('Target.closeTarget', { targetId: PO.targetId }).catch(() => {});

  // The countdown says the mic is on, inside the pill.
  const PB = await open(`chrome-extension://${extId}/bar.html`); await sleep(800);
  const cd = await evalIn(PB.sid, `(() => {
    document.body.className = 'state-countdown';
    const pill = document.querySelector('.bar').getBoundingClientRect();
    const v = document.querySelector('.cd-voice').getBoundingClientRect();
    const x = document.querySelector('#cdCancelBtn').getBoundingClientRect();
    const tr = document.querySelector('.cd-track').getBoundingClientRect();
    return { text: document.querySelector('.cd-voice').textContent.trim(), pill: Math.round(pill.width), inside: v.left >= pill.left && x.right <= pill.right && v.right <= x.left, track: Math.round(tr.width) };
  })()`);
  check('the countdown pill says "Voice on" between the track and Cancel, same size', cd.text === 'Voice on' && cd.pill === 252 && cd.inside && cd.track >= 40, JSON.stringify(cd));
  await shot(PB.sid, 'bar-countdown.png');
  await b.send('Target.closeTarget', { targetId: PB.targetId }).catch(() => {});

  const thrown = exceptions.filter(Boolean);
  check('the popup threw nothing', thrown.length === 0, thrown.join(' | '));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
