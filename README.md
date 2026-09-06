# Fraud Protect

A single-page, accessible interactive film, built with plain HTML, CSS and JavaScript. No npm packages, backend, accounts, analytics or external services are used.

## Commands

Python 3.9+ and Make are the only local requirements.

```sh
make help                 # List commands
make about                # Explain the project
make run                  # Build, serve and open the site in your browser
make run PORT=8080        # Use another port
make stop                 # Stop all preview servers for this project
make build                # Produce a self-contained dist/ folder
```

Press Ctrl+C to stop the local server. It listens on localhost only and supports byte-range requests so videos can seek to the selected ending without downloading the whole file first. Without Make, use `python3 scripts/site.py run` or `python3 scripts/site.py build`.

`make stop` stops every preview started from this project, including previews running on different ports or in other terminals. Each preview registers a private shutdown token in `.preview-servers/`; the stop command contacts only those registered localhost servers. It does not kill processes by name or affect unrelated sites. Stale records are cleaned up when a server has already stopped. These local records are never included in dist. Without Make, use `python3 scripts/site.py stop`.

## Netlify Drop

Run `make build`, then drag the **dist folder** into Netlify Drop. It contains `index.html`, the stylesheet, JavaScript, poster, favicon, Netlify response headers and both original videos. There is no server to deploy and no build command needed on Netlify. The package is approximately 147 MB because it preserves your supplied videos unchanged. The source videos remain in the project root.

Only an explicit list of public files is copied. Source scripts, tests, local memory and other hidden files are excluded. A missing required asset fails the build before replacing an existing dist folder. Rebuilding replaces generated dist contents, so edit the source files rather than dist.

## Story behaviour

- The viewer presses “Watch the story”; sound does not autoplay on arrival.
- The shared introduction uses `ScamProtection_Right.m4v`.
- Playback pauses at the 30-second boundary and displays two equally styled choices, with no time limit.
- “Follow the caller’s instructions” plays `ScamProtection_Wrong.m4v` from 30 seconds.
- “End the call and check independently” plays `ScamProtection_Right.m4v` from 30 seconds.
- When an ending finishes, the viewer can watch the other ending from 30 seconds or restart the entire story.
- Choices and conclusions appear over the film, within the same player area. Endings use five short pages (outcome, three warning signs, and safe next steps), with Back/Next controls instead of an internal scrollbar. Replay controls appear on the outcome page; the final page offers Back to result. The player reserves the largest explanation’s space from the start, including at enlarged text sizes. Transitions never scroll the page, and normal page scrolling is not trapped when the pointer is over the video.
- The playback position control cannot skip past the introduction’s decision or rewind an ending into the shared opening. Pause, sound controls, loading feedback and retry are provided.

The boundary uses video-frame callbacks, media events and a short fallback timer, and clamps the playhead to 30 seconds. Browsers schedule callbacks rather than guarantee frame-exact editing; a suspended or busy browser may briefly run past the boundary before it is clamped. The choice overlay hides playback while the choice is pending.

## Accessibility and editing

### Guided commentary replay

After either ending, **Watch again with commentary** replays the unsafe version from zero. Six on-screen explanations pause the original video, then resume after 12 seconds. **Keep paused** gives unlimited reading time; **Continue film** resumes immediately. Switching to another tab during a commentary pause holds it until the viewer chooses to continue. **Exit commentary** starts the normal interactive story again. No additional video downloads, voice services or runtime libraries are needed.

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

The regression checks use Node.js’s built-in test runner and Python’s standard library, with no install step:

```sh
node --test tests/player.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tests/preview_integration.py  # Localhost checks; stops all project previews
```

The player tests simulate media events; they do not replace testing actual playback in your target browsers. Before sharing widely, watch each path with sound on the devices your viewers use.
