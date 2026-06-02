# Install Brief

## Chrome extension (that's the whole install)

[Download the repo](https://github.com/razi2001/brief/archive/refs/heads/main.zip) and unzip it (or clone it). Then in Chrome:

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. **Load unpacked** → pick the `extension/` folder
4. Pin the ✦ icon to your toolbar

The first time you click ✦, a permission tab opens to grant the microphone, then hands off to a short "how it works" page.

## No skill to install

Every brief you record is a self-contained zip in `~/Downloads/brief/`. It bundles the filing playbook (`skill/SKILL.md` + `skill/playbooks/`) right next to the transcript and screenshots. When you hit **Export**, the copied prompt points your agent at that bundled skill — so any local agent that can read files and reach your tracker (Claude Code Desktop, Cursor, Cline, …) can file the ticket. Nothing is written to `~/.claude/skills/`.

## Updating

Pull the latest repo and reload the unpacked extension at `chrome://extensions`. New briefs bundle the newest skill automatically — there's nothing else to update.

## Uninstall

Remove the extension at `chrome://extensions`. Your briefs in `~/Downloads/brief/` are left alone; delete that folder yourself if you want them gone.
