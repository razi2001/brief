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

  const thrown = exceptions.filter(Boolean);
  check('the popup threw nothing', thrown.length === 0, thrown.join(' | '));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
