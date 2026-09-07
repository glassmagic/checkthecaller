# Check the Caller

A single-page, accessible interactive film, built with plain HTML, CSS and JavaScript. No npm packages, backend, accounts, analytics or external services are used.

## Commands

[uv](https://docs.astral.sh/uv/guides/projects/) and Make are the local requirements. uv manages Python (3.13, recorded in `.python-version`) and the project environment. Tests also use Node.js.

```sh
make help                 # List commands
make about                # Explain the project
make run                  # Build, serve and open the site in your browser
make run PORT=8080        # Use another port
make stop                 # Stop all preview servers for this project
make build                # Produce a self-contained dist/ folder
make test                 # Run player, access and packaging checks
```

Press Ctrl+C to stop the local server. It listens on localhost only and supports byte-range requests so videos can seek to the selected ending without downloading the whole file first. Without Make, use `uv run --locked scripts/site.py run` or `uv run --locked scripts/site.py build`.

`make stop` stops every preview started from this project, including previews running on different ports or in other terminals. Each preview registers a private shutdown token in `.preview-servers/`; the stop command contacts only those registered localhost servers. It does not kill processes by name or affect unrelated sites. Stale records are cleaned up when a server has already stopped. These local records are never included in dist. Without Make, use `uv run --locked scripts/site.py stop`.

## Python dependency management

`pyproject.toml` and committed `uv.lock` are the source of project dependencies. `uv run --locked` creates/synchronises `.venv` automatically and refuses an out-of-date lockfile. Build, preview and tests need no third-party Python libraries. The optional `media` group locks Pillow for the offline portrait tools; FFmpeg remains a system tool. Use `uv add --group media <package>` for media dependencies and commit the updated manifest and lock together. `.venv` is ignored and never published.

Netlify's [Python dependency installation](https://docs.netlify.com/build/configure-builds/manage-dependencies/#python-dependencies) reads `requirements.txt` to bootstrap the pinned uv executable before `make build`. That file contains only uv; application dependencies stay in `pyproject.toml` and `uv.lock`. Netlify's build command and publish directory remain `make build` and `dist`.

## Access-code entry page

Visitors first see the Check the Caller landing page and enter **check2026**. Matching ignores case and spaces at either end. Successful entry is remembered for this browser tab's session; a new session asks again. If storage is unavailable, entry still works, but refreshing asks again. Change `ACCESS_CODE` in `access.js` (uppercase) to change the shared code; rebuild and deploy. Old remembered codes will no longer match.

The player script and video downloads start only after the correct code is entered. Invalid or empty codes show a readable error; an interrupted player-script download can be retried. The landing page uses a visible text field, large controls and no emoji. The film's play icons use SVG/CSS shapes.

This is a lightweight entry screen, **not authentication**. The code and static HTML/videos remain publicly accessible; it does not protect private material. The site remains a static Netlify Drop package without a backend.

## Netlify Drop

Run `make build`, then drag the **dist folder** into Netlify Drop. It contains `index.html`, the stylesheet, JavaScript, posters, bookmark icons, Netlify response headers, both original videos and their smaller portrait versions. There is no server to deploy and no build command needed on Netlify. The package is approximately 170 MB, including your supplied videos unchanged. The source videos remain in the project root.

Only an explicit list of public files is copied. Source scripts, tests, local memory and other hidden files are excluded. A missing required asset fails the build before replacing an existing dist folder. Rebuilding replaces generated dist contents, so edit the source files rather than dist.

## GitHub and automatic Netlify deploys

Source repository: [glassmagic/checkthecaller](https://github.com/glassmagic/checkthecaller). The SSH remote is `git@github.com:glassmagic/checkthecaller.git`.

Production: [checkthecaller.netlify.app](https://checkthecaller.netlify.app). Manage the site in the [Netlify dashboard](https://app.netlify.com/projects/checkthecaller). It belongs to the same Netlify team as Playgraze (`adampowell-is`), with site ID `bbc760d7-a824-4ee4-9035-3de1f74e4ac3`.

The workflow follows Playgraze: make changes on a feature branch, open a ready-for-review pull request, review its Netlify Deploy Preview, then merge on GitHub to publish. The user handles merges. The initial import seeded the empty repository's `main` branch; subsequent changes go through PRs.

Netlify is connected directly to GitHub, so no GitHub Actions deployment workflow or deployment token in the repository is needed. Settings are stored in Netlify, as they are for Playgraze:

PR previews use `https://deploy-preview-<PR number>--checkthecaller.netlify.app`. Netlify is configured to add their status and URL to the GitHub PR. The custom domain `checkthecaller.co.uk` is also configured in Netlify.

Repository events are delivered through GitHub's Netlify webhook (`push`, `pull_request`, and branch `delete`), using the endpoint configured by Netlify. This is the webhook mechanism supported by Netlify CLI, with no Actions workflow needed. Native GitHub App notifications report build status, checks and preview links, matching Playgraze. The Netlify GitHub App must have access to `checkthecaller` for this integration to work.

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `make build` |
| Publish directory | `dist` |
| Base directory | Empty (repository root) |
| Deploy Previews | Enabled for pull requests |

Playgraze publishes its repository root without a build command. This site publishes `dist` because it packages videos and must exclude local scripts, tests and private runtime files. The local Netlify CLI connection is in ignored `.netlify/state.json`. Existing Make commands and Netlify Drop remain available.

Both videos are tracked directly in Git, and `dist` is ignored. Each video is below GitHub's 100 MiB per-file limit, although GitHub warns for files over 50 MiB. See [GitHub's large-file guidance](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) before replacing them with larger files.

## Story behaviour

- The viewer presses “Watch the story”; sound does not autoplay on arrival.
- The shared introduction uses the right-ending film, with the matching portrait version on upright phones.
- Playback pauses at the 30-second boundary and displays two equally styled choices, with no time limit.
- “Follow the caller’s instructions” plays `ScamProtection_Wrong.m4v` from 30 seconds.
- “End the call and check independently” plays `ScamProtection_Right.m4v` from 30 seconds.
- When an ending finishes, the viewer can watch the other ending from 30 seconds or restart the entire story.
- Choices and conclusions appear over the film, within the same player area. Endings use six short pages (outcome, three warning signs, safe next steps, and replay choices), with Back/Next controls instead of an internal scrollbar. The outcome offers shortcuts to the warning signs or replay choices. Its navigation strip is invisible; advice pages show Back/Next without changing the reserved player height. The player reserves the largest explanation’s space from the start, including at enlarged text sizes. Transitions never scroll the page, and normal page scrolling is not trapped when the pointer is over the video.
- The playback position control cannot skip past the introduction’s decision or rewind an ending into the shared opening. Pause, sound controls, loading feedback and retry are provided.

The boundary uses video-frame callbacks, media events and a short fallback timer, and clamps the playhead to 30 seconds. Browsers schedule callbacks rather than guarantee frame-exact editing; a suspended or busy browser may briefly run past the boundary before it is clamped. The choice overlay hides playback while the choice is pending.

## Mobile framing and loading

Portrait phones up to 650 CSS pixels wide use dedicated 576 × 1024, 24 fps MP4s (about 11–12 MB each). Desktop and landscape use the original films. Rotating preserves the current time, chosen ending and paused state. Choices, short result pages and commentary are arranged for a narrow screen, with large buttons and ordinary page scrolling. The title and bookmark/home-screen icons use **Check the Caller**.

The mobile crops are baked into the videos, so they change at the original shot-cut frames without depending on JavaScript callbacks. Most shots hold a fixed crop width with gentle horizontal movement when necessary. Wider views retain the phone, card and face when those cannot all fit a tight portrait crop; a dim blurred surround fills the remaining space. Camera zooms already present in the originals remain.

`media/portrait-framing.json` records zero-based frames, exclusive shot ends and crop poses. After changing the plan, install FFmpeg/ffprobe and use the optional uv `media` group to regenerate and verify:

```sh
uv run --locked --group media scripts/render_portrait.py --proof-dir /tmp/checkthecaller-portrait-proof
uv run --locked --group media scripts/verify_portrait.py
```

Inspect the proof sheets, particularly every cut and the phone/card actions. Commit the two derived MP4s, portrait poster, framing plan, manifest and verification report together. The manifest records source/output hashes; verification checks encoded cut-boundary frames and unchanged AAC audio packets. These tools run offline and are **not** part of `make build`; deployment uses uv and Make without installing the optional media group.

Once the active film reports that it can play through, the other ending downloads in the background at low priority. A completed download is reused directly when selected. An unfinished or failed download never blocks the choice: the normal media loader takes over. Rotation cancels obsolete background requests. The Netlify Content Security Policy permits only same-origin downloads and local media blobs for this feature. Browsers may defer loading on constrained connections, so background preparation reduces rather than guarantees the absence of buffering.

## Accessibility and editing

### Guided commentary replay

After either ending, **Watch again with commentary** replays the unsafe version from zero. Six on-screen explanations pause the video. On phones they use shorter wording and wait for **Continue film**, giving unlimited reading time. On desktop they resume after 12 seconds. **Keep paused** gives unlimited reading time; **Continue film** resumes immediately. Switching to another tab during a commentary pause holds it until the viewer chooses to continue. **Exit commentary** starts the normal interactive story again. The replay reuses the unsafe film for the current orientation; no voice services or runtime libraries are needed.

The replay passes through the original 30-second choice automatically. Completing it shows the unsafe outcome and the usual replay options. Rewinding lets the viewer see the explanations again; seeking forward stops at the first unseen warning. Error retries preserve the guided replay and already-seen warnings. The notes and their controls stay over the film without scrolling the page.

The cue positions in `COMMENTARY_CUES` in `app.js` were aligned using a local speech transcription of the supplied unsafe video:

| Video time | Commentary |
| --- | --- |
| 11.50 seconds | An unexpected caller claiming to be from the bank’s fraud team |
| 16.90 seconds | A claim that money is at risk, creating fear and urgency |
| 42.80 seconds | Asking for the full card number as a supposed security check |
| 51.90 seconds | Asking her to read out a one-time text code |
| 58.35 seconds | Dismissing the text’s “do not share” warning |
| 64.90 seconds | Claiming the money will be moved to a “safe account” |

These are media timestamps; commentary pauses add to the total viewing time. Adjust the cue times if the source video changes. Advice is based on [Take Five’s impersonation guidance](https://www.takefive-stopfraud.org.uk/protect-yourself/impersonation-fraud/) and [its guidance on protecting information and one-time codes](https://www.takefive-stopfraud.org.uk/protect-yourself/).

### Page accessibility

The page uses large controls, high contrast, visible keyboard focus, a skip link, screen-reader announcements, no time-limited choices and responsive layouts. It respects reduced motion and browser text sizing. The supplied videos do not include subtitle tracks; captions have not been fabricated. For a captioned release, add checked WebVTT files and switch the matching `<track>` when changing videos.

Edit `index.html` for page and choice wording, `styles.css` for appearance and `app.js` for outcome wording and the `CHOICE_TIME` constant. Keep the original video filenames unless you also update their references in the HTML, JavaScript and the `PUBLIC_FILES` list in `scripts/site.py`.

## Checks

The regression checks use Node.js’s built-in test runner and Python’s standard library through uv:

```sh
make test
uv run --locked tests/preview_integration.py  # Localhost checks; stops all project previews
```

The player tests simulate media events; they do not replace testing actual playback in your target browsers. Before sharing widely, watch each path with sound on the devices your viewers use.
