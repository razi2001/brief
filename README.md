<div align="center">

# ✦ Brief

**Voice your bug. Your agent ships the ticket.**

A Chrome extension for people who use a coding agent. Record what's broken, hit stop — your agent reads the brief and files the ticket. No more breaking flow to write one up.

[Install](#install) · [How it works](#how-it-works) · [FAQ](#faq)

</div>

---

## What is this

You spot a bug or want a feature. You hit ✦ in your toolbar, talk through what you want while showing it on screen, and stop. Brief saves a zip locally in `~/Downloads/brief/` and adds it to your inbox.

Capture as many as you like through the day — they queue up. Then copy the inbox prompt and paste it into your coding agent. The agent reads each brief, files a real ticket in your tracker, groups duplicates, and deletes the source brief once it's filed.

The whole loop is local-first. Your audio, your screen, your data — nothing leaves your machine except what your agent reads when you ask.

## Requirements

- **Chrome** (or any Chromium-based browser: Edge, Brave, Arc)
- **A coding agent with file access and a tracker connected** — anything that can read local files and reach your tracker via an integration/MCP (Linear, GitHub, Jira, Notion — whichever you use)

Brief does the capturing; your agent does the filing. It won't file tickets standalone — some local agent is what actually files them.

## Install

**Just the Chrome extension — there's no skill to install.**

1. [Download the repo](https://github.com/razi2001/brief/archive/refs/heads/main.zip) and unzip it (or clone it).
2. Open `chrome://extensions`, toggle **Developer mode** on, click **Load unpacked**, pick the `extension/` folder.
3. Pin the ✦ icon to your toolbar (puzzle-piece menu → pushpin).

The first time you click ✦, a permission tab opens to grant the microphone, then hands off to a short "how it works" page.

**Why no skill install?** Every brief you record is a self-contained zip — it includes the filing playbook (`skill/SKILL.md` + `skill/playbooks/`) right alongside the transcript and screenshots. When you Export, the copied prompt points your agent at that bundled skill. So any local agent that can read files and reach your tracker can file the ticket — nothing has to live in a global skills folder.

That's it.

## How it works

```
┌──────────────────┐    ┌────────────────────┐    ┌──────────────────┐
│  Chrome ext      │ →  │  ~/Downloads/      │ →  │  Your agent      │
│  records tab +   │    │  brief/            │    │  reads brief.json│
│  voice           │    │  brief-<id>.zip    │    │  files ticket    │
└──────────────────┘    └────────────────────┘    │  deletes brief   │
       click ✦              local zip              └──────────────────┘
```

A brief is a folder:

```
~/Downloads/brief/<id>/
├── brief.json              ← transcript, time-stamped chunks, events, console errors
├── recording.webm          ← original screen + voice
└── keyframes/
    ├── keyframe-000.png    ← sampled every 2s
    └── …
```

When your agent processes briefs (one at a time, or your whole inbox at once), it:

- Binary-searches the keyframes (reads 3-5 strategic frames, not all 20+)
- Maps your spoken words to the frames you said them on (±2 seconds)
- Picks the right Linear team / GitHub repo / Notion DB **without asking you**
- Embeds keyframes inline as markdown images (not as bare attachments)
- Attaches the recording only when it beats the keyframes (motion/timing/multi-step bugs)
- Includes console errors verbatim for bug reports
- **Deletes the brief from `~/Downloads/brief/` once the ticket is confirmed filed**

The skill's hard rules (no clarifying questions, inline images, binary-search frames, delete-on-success) live in `extension/skill/` — and a copy is bundled into every brief zip so any agent can read them.

## Processing your inbox

Click the ✦ icon, hit **Export** once you've recorded at least one brief, and paste the prompt into your coding agent whenever you like. The agent reads every exported brief, files the tickets, groups duplicates, and deletes each brief once its ticket is filed. Briefs you haven't recorded yet stay in your list for later.

## Voice quality, honestly

The extension uses Chrome's built-in speech recognition (`webkitSpeechRecognition`). It's free and runs locally, but:

- One language per session — pick English or French on the recording bar; **it does not auto-switch**.
- Accuracy on accents, code, and technical jargon is mediocre.
- The skill knows this. Its playbook tells the agent to treat the transcript as a "live draft" and use keyframes + events as ground truth, silently correcting obvious mis-transcriptions.

A future release may support OpenAI Whisper for genuinely good multilingual transcription.

## Privacy

- Recording happens entirely in your browser. The video file never uploads anywhere.
- The browser sends your microphone audio to Google's speech-recognition service while transcribing (this is `webkitSpeechRecognition`, not us). It does not store the audio.
- Console-error capture only runs while you're actively recording, only on the tab you're recording, and only forwards error messages — no DOM, no cookies, no storage.
- Briefs are saved locally. They never leave your machine unless you hand them to your agent (and even then, only the agent on your machine reads them).

## FAQ

**Which coding agents work?**
Any local agent that can read files and reach your tracker. A brief is a self-contained folder with the filing skill inside, so the agent just needs file access and a tracker integration. Without some local agent to read them, the briefs just sit there unprocessed.

**Does it work on `chrome://` pages?**
No. Chrome blocks tab capture on its own pages. Use it on regular websites and web apps.

**What about Firefox / Safari?**
Chromium-based browsers only for now (Chrome, Edge, Brave, Arc).

**Where do briefs get stored?**

- macOS / Linux: `~/Downloads/brief/`
- Windows: `%USERPROFILE%\Downloads\brief\`

**Can I share a brief with a teammate?**
The zip is self-contained — it includes the skill. Send it to them; they unzip it and paste `Read brief-<id>/skill/SKILL.md and follow it to file this as a ticket.` into any local agent and it'll process it on their machine.

**Why did the recording bar move when I zoomed?**
It shouldn't anymore. You *can* drag it (grip the 6-dot handle on the left); its position is saved across tabs. It scales with Chrome page-zoom like everything else on the page, but it stays put.

## Updating

The skill ships inside each brief, so there's nothing in a global skills folder to update. To get skill or extension improvements, pull the latest repo and reload the unpacked extension at `chrome://extensions` — new briefs you record will bundle the newest skill automatically.

## Uninstall

Remove the extension at `chrome://extensions`. Your briefs in `~/Downloads/brief/` are left alone — delete that folder yourself if you want them gone.

## License

MIT — see [LICENSE](LICENSE).
