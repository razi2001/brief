<div align="center">

# Brief

**Talk through a bug. Brief writes the ticket and files it.**

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/heekinkibhgbilagcdnmcjajijaalpcc?label=Chrome%20Web%20Store&color=dd6936)](https://chromewebstore.google.com/detail/heekinkibhgbilagcdnmcjajijaalpcc)
[![Release](https://img.shields.io/github/v/release/razi2001/brief?color=dd6936)](https://github.com/razi2001/brief/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-dd6936)](LICENSE)

[Try it](https://get-brief.app) · [Self-host](SELF_HOSTING.md) · [Audit](AUDIT.md) · [Discussions](https://github.com/razi2001/brief/discussions)

</div>

<img src="docs/screenshots/extension.png" alt="The Brief extension on a website, with a recording and a note" width="100%">

<img src="docs/screenshots/app.png" alt="The filed ticket in the Brief app" width="100%">

## How it works

- **The extension** records your tab, your voice, screenshots and console errors while you show the bug.
- **The service** (a Next.js app) transcribes it, writes the ticket with steps to reproduce, and files it to Linear, Jira, GitHub, GitLab, Azure DevOps, ClickUp, Notion, Trello, Asana or Monday.
- **Your data:** the people running a Brief server can't read your tickets in its admin views, and you can host your own.

More in [ARCHITECTURE.md](ARCHITECTURE.md) and [PRIVACY.md](PRIVACY.md).

## Self-host

Paste into Claude Code (or any coding agent):

```text
Clone https://github.com/razi2001/brief and set it up for me by following SELF_HOSTING.md.
```

## Audit us

Paste into your agent:

```text
Clone https://github.com/razi2001/brief and audit it by following AUDIT.md.
```

---

[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)
