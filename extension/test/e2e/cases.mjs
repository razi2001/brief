// Pages with one planted bug each, for the ticket eval (web/scripts/ticket-eval).
// record-cases.mjs serves each at http://cases.brief.localhost:3997/<case>, does
// what a user would, and takes the last minute as a one-click report. Each case:
// the page, how its API answers, the user's steps, and what the eval should find.

const shell = (title, body, script = '') => `<!doctype html><html><head><title>${title} - Acme QA</title>
<style>
body{font:15px system-ui,sans-serif;margin:0;background:#f6f7f9;color:#1d2330}
header{background:#1d2330;color:#fff;padding:12px 24px;display:flex;gap:24px;align-items:center}
header b{font-size:16px} header a{color:#c9d1e0;text-decoration:none}
main{padding:28px 32px;max-width:880px}
h1{font-size:22px;margin:0 0 18px}
label{display:block;margin:12px 0 4px;font-weight:600}
input[type=text],input:not([type]){font:inherit;padding:8px 10px;border:1px solid #c5ccd8;border-radius:6px;width:320px}
button{font:inherit;padding:8px 16px;border-radius:6px;border:1px solid #2f5bd3;background:#2f5bd3;color:#fff;cursor:pointer;margin-top:14px}
.err{color:#c62828;margin-top:8px} .ok{color:#1b7f3b;margin-top:8px}
table{border-collapse:collapse;background:#fff;width:100%;table-layout:fixed} td,th{border-bottom:1px solid #e3e7ee;padding:10px;text-align:left}
.spinner{width:28px;height:28px;border:3px solid #c5ccd8;border-top-color:#2f5bd3;border-radius:50%;animation:spin 1s linear infinite;margin:24px 0}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><header><b>Acme QA</b><a href="#">Projects</a><a href="#">Test cases</a><a href="#">Reports</a></header><main>${body}</main><script>${script}</script></body></html>`;

const reply = (res, status, body, delay = 0) => setTimeout(() => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}, delay);

export const CASES = {
  'save-500': {
    expect: {
      kind: 'failure',
      bug: 'Saving a test case fails: the save request returns a 500 server error and the page shows no message, so the user does not know the edit was not saved.',
      facts: ["The save request (PUT /api/cases/42) returns 500 with the body {\"error\":\"database timeout\"}, about 0.6 s after each click.","The user edited the title and clicked Save twice; both saves failed the same way."],
      variants: [{ name: 'one-click' }, { name: 'described', description: "can't save my test case" }],
    },
    html: shell('Edit test case', `<h1>Edit test case</h1>
<label for="title">Title</label><input id="title" value="Login with SSO"/>
<label for="steps">Steps</label><input id="steps" value="Open login, click SSO"/>
<div><button id="save">Save</button></div>`,
    `save.onclick=async()=>{save.disabled=true;save.textContent='Saving...';try{await fetch('/api/cases/42',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({title:title.value})});}catch(e){}save.disabled=false;save.textContent='Save';};`),
    api: { 'PUT /api/cases/42': (req, res) => reply(res, 500, { error: 'database timeout' }, 600) },
    flow: [{ type: ['#title', ' (edited)'] }, { wait: 800 }, { click: '#save' }, { wait: 2500 }, { click: '#save' }, { wait: 2500 }],
  },

  'save-200-error': {
    expect: {
      kind: 'ui',
      bug: 'Notification settings do not save: clicking Save shows nothing, and after a reload the option is off again.',
      facts: ["The user ticked the option, clicked Save, then reloaded the page.","The save request (POST /api/settings) returns 200; its body says the save failed, which the browser log does not show."],
      variants: [{ name: 'one-click' }, { name: 'described', description: 'my notification setting keeps turning itself off' }],
    },
    html: shell('Notification settings', `<h1>Notification settings</h1>
<label><input type="checkbox" id="failed"/> Email me when a run fails</label>
<div><button id="save">Save</button></div>`,
    `save.onclick=()=>{fetch('/api/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({emailOnFail:failed.checked})}).then(r=>r.json()).then(()=>{}).catch(()=>{});};`),
    api: { 'POST /api/settings': (req, res) => reply(res, 200, { ok: false, error: 'Workspace is read-only' }, 300) },
    flow: [{ click: '#failed' }, { wait: 600 }, { click: '#save' }, { wait: 2000 }, { reload: true }, { wait: 2000 }],
  },

  'validation': {
    expect: {
      kind: 'ui',
      bug: "Inviting a teammate is blocked: the form says 'Please enter a valid email address' for a valid address (it has a dot before the @).",
      facts: ["The address typed was ana.lopez@acme.io; the page masks what was typed.","No network request is made; the check runs in the page."],
      variants: [{ name: 'one-click' }, { name: 'described', description: 'it says the email is invalid but it is correct' }],
    },
    html: shell('Invite teammate', `<h1>Invite a teammate</h1>
<label for="email">Email</label><input id="email" placeholder="name@company.com"/>
<div><button id="send">Send invite</button></div><p id="msg"></p>`,
    `send.onclick=()=>{const ok=/^[a-z]+@[a-z]+\\.[a-z]{2,3}$/.test(email.value);msg.className=ok?'ok':'err';msg.textContent=ok?'Invite sent':'Please enter a valid email address';};`),
    api: {},
    flow: [{ type: ['#email', 'ana.lopez@acme.io'] }, { wait: 600 }, { click: '#send' }, { wait: 1500 }, { click: '#send' }, { wait: 1500 }],
  },

  'stuck-spinner': {
    expect: {
      kind: 'failure',
      bug: 'The projects list never loads: the request for the list fails (504 Gateway Timeout) and the page keeps showing a spinner with no message.',
      facts: ["GET /api/projects returns 504 (Gateway Timeout) with the body {\"error\":\"upstream timed out\"} after about 3 s, once on load and once after Refresh.","No message is shown; the spinner stays."],
      variants: [{ name: 'one-click' }, { name: 'described', description: 'projects page stuck loading' }],
    },
    html: shell('Projects', `<h1>Projects</h1><div id="list"><div class="spinner"></div></div><button id="reload">Refresh</button>`,
    `const load=()=>{list.innerHTML='<div class="spinner"></div>';fetch('/api/projects').then(r=>r.json()).then(d=>{if(d.projects)list.innerHTML=d.projects.map(p=>'<p>'+p+'</p>').join('');}).catch(()=>{});};load();reload.onclick=load;`),
    api: { 'GET /api/projects': (req, res) => reply(res, 504, { error: 'upstream timed out' }, 3000) },
    flow: [{ wait: 4500 }, { click: '#reload' }, { wait: 4500 }],
  },

  'dead-button': {
    expect: {
      kind: 'ui',
      bug: 'The Export CSV button on the Reports page does nothing when clicked: no download, no message.',
      facts: ["Clicking Export CSV makes no request and logs no error; the user clicked it four times."],
      variants: [{ name: 'one-click' }, { name: 'described', description: 'export does not work' }],
    },
    html: shell('Reports', `<h1>Reports</h1>
<table><tr><th>Run</th><th>Passed</th><th>Failed</th></tr><tr><td>Nightly #212</td><td>184</td><td>3</td></tr><tr><td>Nightly #211</td><td>186</td><td>1</td></tr></table>
<button id="export">Export CSV</button>`, ''),
    api: {},
    flow: [{ wait: 1000 }, { click: '#export' }, { wait: 1500 }, { click: '#export' }, { click: '#export' }, { click: '#export' }, { wait: 2000 }],
  },

  'layout': {
    expect: {
      kind: 'ui',
      bug: "On the Test runs table, a long test name runs over the Status column, so that row's status can't be read.",
      facts: ["The overlapping row is Checkout applies the loyalty discount after the coupon is removed; its status is Failed.","No request fails and no error is logged."],
      variants: [{ name: 'one-click' }, { name: 'described', description: 'the runs table looks broken' }],
    },
    html: shell('Test runs', `<h1>Test runs</h1>
<table><tr><th style="width:220px">Test</th><th>Status</th><th>Duration</th></tr>
<tr><td>Login with SSO</td><td>Passed</td><td>12 s</td></tr>
<tr id="long"><td style="white-space:nowrap;overflow:visible">Checkout applies the loyalty discount after the coupon is removed</td><td>Failed</td><td>48 s</td></tr>
<tr><td>Search by tag</td><td>Passed</td><td>9 s</td></tr></table>`,
    `document.querySelectorAll('tr').forEach(r=>r.onclick=()=>{document.querySelectorAll('tr').forEach(x=>x.style.background='');r.style.background='#eef3ff';});`),
    api: {},
    flow: [{ wait: 1500 }, { click: '#long' }, { wait: 2500 }],
  },

  'slow-search': {
    expect: {
      kind: 'failure',
      bug: 'Searching test cases takes about 9 seconds to show results; the search request itself takes about 9 seconds.',
      facts: ["GET /api/search?q=invoice returns 200 after about 9 s; then three results show.","The page shows Searching... while it waits."],
      variants: [{ name: 'one-click' }, { name: 'described', description: 'search is really slow' }],
    },
    html: shell('Search', `<h1>Search test cases</h1><input id="q" placeholder="Search"/> <button id="go">Search</button><div id="out"></div>`,
    `go.onclick=()=>{out.innerHTML='<p>Searching...</p>';fetch('/api/search?q='+encodeURIComponent(q.value)).then(r=>r.json()).then(d=>{out.innerHTML=d.results.map(x=>'<p>'+x+'</p>').join('');});};`),
    api: { 'GET /api/search': (req, res) => reply(res, 200, { results: ['Invoice totals round correctly', 'Invoice PDF download', 'Invoice email reminder'] }, 9000) },
    flow: [{ type: ['#q', 'invoice'] }, { wait: 500 }, { click: '#go' }, { wait: 10500 }],
  },

  'clean': {
    expect: {
      kind: 'none',
      bug: 'Nothing is wrong: adding a to-do and checking it off both work.',
      facts: ["POST /api/todos returns 201; the new item appears, and its checkbox ticks when clicked.","No request fails and no error is logged."],
      variants: [{ name: 'one-click' }, { name: 'described', description: 'something felt off when adding a todo' }],
    },
    html: shell('To-do', `<h1>To-do</h1><input id="item" placeholder="New item"/> <button id="add">Add</button><ul id="list"></ul>`,
    `add.onclick=()=>{fetch('/api/todos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:item.value})}).then(r=>r.json()).then(()=>{const li=document.createElement('li');li.innerHTML='<label><input type=checkbox> '+item.value.replace(/</g,'&lt;')+'</label>';list.appendChild(li);item.value='';});};`),
    api: { 'POST /api/todos': (req, res) => reply(res, 201, { id: 7 }, 150) },
    flow: [{ type: ['#item', 'Review release notes'] }, { click: '#add' }, { wait: 1200 }, { click: '#list input' }, { wait: 1500 }],
  },
};
