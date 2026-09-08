# Check the Caller

This is the static fraud-awareness site in `glassmagic/checkthecaller`, aimed at older viewers. It uses plain HTML, CSS and JavaScript plus two supplied videos. After the shared code, a menu offers two parts: an HTML presentation (*Staying Safer in a Digital World*, 13 pages) and the *Check the Caller* interactive film. Keep the large text, clear controls, 30-second choice, both endings and optional commentary replay. Keep explanations over the film and avoid automatic page scrolling.

## GitHub workflow

- The empty repository was bootstrapped with the finished site on `main`. All subsequent work uses a feature branch and a pull request.
- The user reviews and merges PRs on GitHub. Do not merge or push changes directly to `main` unless explicitly asked.
- Open PRs ready for review, not draft. Follow-up requests for an open PR can use additional commits on the same branch; keep its description current.
- After the user says a PR is merged, switch to `main`, pull with `--ff-only`, fetch with `--prune`, and remove the merged local branch if safe.
- Keep the repository public as configured. Do not change its visibility without an explicit request.

### Routine change process

This follows the branch, review and deployment process in Playgraze's `AGENTS.md`, adapted to this site's build and player.

1. Read this file, check `git status`, the current branch and the current PR state before editing. Preserve unrelated user changes.
2. Use one feature branch per PR. Add follow-up requests to the same open PR as separate commits; if it has merged, start a new branch from updated `main`.
3. Make the requested change and run the relevant checks below. Keep small copy or documentation changes lean: inspect all affected occurrences and the diff, without unrelated refactors or new test infrastructure.
4. Commit and push, then open or update a ready-for-review PR. Describe what changed and the checks actually performed. Verify `isDraft` is false with `gh pr view <number> --json isDraft` and give the user the PR link.
5. The user merges and normally deletes the remote branch. Once they report the merge, confirm it on GitHub, switch to `main`, pull with `--ff-only`, fetch with `--prune`, and safely delete the merged local branch. Do not discard uncommitted work or unmerged commits during cleanup.
6. Verify the production deploy is ready for the merged `main` commit and that the affected public files are served. Use commit IDs to track deployment; this site does not use Playgraze's game-specific PR/version-number convention.

## Netlify deployment

- This project uses Netlify's native GitHub integration, like Playgraze. Merges into `main` trigger production builds; pull requests receive Deploy Previews. GitHub Actions is not needed to deploy.
- Netlify project: `checkthecaller`, team `adampowell-is`, site ID `bbc760d7-a824-4ee4-9035-3de1f74e4ac3`. Netlify URL: `https://checkthecaller.netlify.app`; configured custom domain: `https://checkthecaller.co.uk`. PR previews: `https://deploy-preview-<PR number>--checkthecaller.netlify.app`.
- Build settings live in Netlify: production branch `main`, build command `make build`, publish directory `dist`, no base directory.
- Keep that single source of build configuration; do not add a redundant `netlify.toml` or GitHub Actions deployment workflow.
- Never publish the repository root. `scripts/site.py` copies only approved public files into `dist`.
- Keep `.netlify/`, generated `dist/`, `.preview-servers/`, `.mcp_memory/`, environment files and Python caches out of Git.
- The local Netlify link is stored in ignored `.netlify/state.json`. Read the site ID there; never copy Playgraze's ID or modify its deployment.
- Builds are triggered by the Netlify GitHub App (installation `139677806`), which must have access to `glassmagic/checkthecaller`. The repository has **no** repository-level webhook and must not get one: a leftover legacy `api.netlify.com/hooks/github` webhook was the original cause of merges not deploying (GitHub reported 204 OK deliveries while Netlify created no build). If a repo webhook to Netlify reappears, the link is wrong; re-link the repository through the Netlify UI rather than adding hooks.
- Deploy Preview URLs (not production) carry an injected Netlify toolbar: a `/.netlify/scripts/cdp` script that 404s and a 48px iframe framing `app.netlify.com`. The `_headers` CSP blocks both, so previews show a grey strip with a broken-image icon at the foot of the page. Our own HTML contains no Netlify markup and production has no injection, so this is preview-only cosmetic noise. Do not broaden the CSP to accommodate it; if it needs to go, turn off the Netlify Drawer in the project's Deploy Preview settings.
- Preserve Netlify hosting. Do not register or deploy this project with another hosting service unless the user asks.
- The original videos are currently under GitHub's regular Git per-file size limit and are tracked directly. Do not silently replace them, convert them to LFS pointers or include duplicate copies from `dist`.

### Deployment verification and troubleshooting

Use the authenticated Netlify CLI from this project. Inspect actual deploy records when GitHub reports a preview failure or a build does not appear:

```sh
netlify api listSiteDeploys --data '{"site_id":"bbc760d7-a824-4ee4-9035-3de1f74e4ac3","per_page":5}'
gh pr view <number> --repo glassmagic/checkthecaller --json state,isDraft,statusCheckRollup
```

Compare `context`, `review_id`, `commit_ref`, `state` and `error_message` with the intended PR or production commit. A successful webhook response alone does not prove that Netlify created a build. Do not trigger repeated production builds just to test documentation changes. For routine low-risk changes, hand over the PR promptly; wait for a preview when deployment is the task or the change warrants it.

Setup status checked on 7 September 2026 (recheck before treating it as current):

- Automatic production deploys from `main` are confirmed working. After re-linking the repository in Netlify (which replaced the stale legacy webhook with the GitHub App event path), a push of `b63af74` at 21:01:29Z produced a Netlify build at 21:01:30Z with no manual trigger. Before the re-link, PR #1 (`d164a6e`) and PR #2 (`cdbc633`) merged without triggering any build and were deployed manually.
- Manual fallback if a merge does not build within a minute: `netlify api createSiteBuild --data '{"site_id":"bbc760d7-a824-4ee4-9035-3de1f74e4ac3"}'`. This builds on Netlify from the repository's `main`; nothing is uploaded from the local machine. Prefer it over `netlify deploy --build --prod`, which publishes the local working tree and uploads the ~170 MB `dist`.
- Do not diagnose a missing build as an untrusted-contributor problem without evidence: the sole team member is an Owner linked to GitHub `glassmagic`, and held builds would show `deploy_pending_review_reason` on `listSiteBuilds`. The failure mode seen here created no build record at all.
- Automatic PR Deploy Previews are confirmed working since the re-link: PR #3 received a `deploy-preview` deploy (`review_id` 3) within 30 seconds of its push, with no manual trigger. PR #2 predates the re-link and received none.
- `https://checkthecaller.co.uk` passes HTTPS validation and returns HTTP 200. Do not disable certificate verification.
- No deployment setup work is outstanding. Do not re-verify or re-link unless a merge or PR fails to build.

## Work and checks

- `make help`, `make about`, `make run`, `make stop`, `make build` and `make test` are the supported commands. `make run PORT=8080` selects another port.
- `make stop` shuts down project preview servers only. `tests/preview_integration.py` also stops all project previews; do not run it casually during unrelated changes.
- Run `make test` for player/access/packaging changes. It uses Node's built-in test runner and `uv run --locked python -m unittest discover -s tests -p 'test_*.py'`.
- Run `make build` and `git diff --check` before delivery. Describe the checks actually performed; simulated media tests do not establish real-browser playback.
- Check the Netlify deploy record for real build errors, and verify the matching commit when reporting a deployment as ready. Do not treat a local build or successful Git push as proof of deployment.
- Commentary cue times refer to the original unsafe video. Update them only against the dialogue, not by guessing.

## Mobile video and interface

- Keep the Check the Caller page title, bookmark icons and home-screen title consistent. Existing saved bookmarks may retain a name previously chosen by the viewer.
- Upright phones (max-width 650px) use the pre-rendered `assets/portrait-*.mp4` files; desktop and landscape retain the source `.m4v` files. Preserve playback position, chosen branch, commentary state and pauses when switching orientation.
- Mobile reframing lives in `media/portrait-framing.json`: zero-based 24 fps frames, exclusive shot ends, poses `[frame, centre x, width]`. Prefer closer, steady framing with a fixed width within each shot. Pan only to follow action; widen only to retain separated phone/card/face details. Do not add arbitrary zoom pulses or interpolate across hard cuts.
- Generate derivatives offline with `uv run --locked --group media scripts/render_portrait.py --proof-dir /tmp/portrait-proof` (Pillow + FFmpeg/ffprobe), inspect the sheets, then run `uv run --locked --group media scripts/verify_portrait.py`. Commit the framing plan, manifest, verification report, portrait poster and both MP4s together. Preserve 2039 right / 2161 wrong frames at 24 fps, the 30-second branch point and original AAC packets. Keep these optional rendering dependencies out of Netlify builds.
- The outcome page has no “Your result” strip; navigation is invisible there while reserving its space. Result screens reserve their largest page before playback. Avoid nested scroll areas and automatic scrolling. Check choice, all result pages and all commentary pauses at 320×568 and a larger portrait viewport. Keep buttons readable and reachable without reducing text to fit.
- Compact commentary stays paused until Continue film; desktop retains the 12-second timer with Keep paused. Preserve the existing cue times and all six explanations.
- Background preloading begins on `canplaythrough`, fetches only the other ending for the current presentation, and uses the completed local blob on selection. Never wait for an unfinished background download before starting the selected film. Keep normal loading/Retry as fallback and cancel obsolete requests on rotation.
- `_headers` must permit `connect-src 'self'` and `media-src 'self' blob:` for preloading. Do not broaden these to external domains. Validate actual cached playback in the browser, as simulated media tests alone cannot verify decoding or response headers.

## Presentation, menu and shared design

- The presentation in `index.html` (`#presentation`, pages `#slide-1` to `#slide-13`) is the HTML version of `Staying-Safer-in-a-Digital-World-updated.pptx`. Keep its wording, page order and page count matching the deck unless the user supplies a new deck. The `.pptx` is reference material only (project root, if present) and is never copied into `dist`.
- Approved adaptations to the updated deck: page 12 uses the neutral heading “Two types of scam to watch for”, tidied spelling and punctuation, and readable orange/yellow panels. Page 13 uses lighter coloured text highlights and white advice links for contrast. Keep the menu, initial page counter and navigation tests at thirteen pages. The presenter introduction stays encrypted.
- Compare rendered PowerPoint slides when changing the presentation design. Desktop uses a 16:9 minimum canvas that grows with content; phones reflow the cards and diagrams with 20px body text. Never shrink or clip a whole slide to make it fit. The presentation's Calibri-compatible Carlito fonts are self-hosted in `assets/fonts/`, with their OFL licence, and included in the packaging allowlist. Keep this typography scoped to the presentation.
- `access.js` owns the menu and routing: the address hash is the single source of truth (`#film`, `#slide-N`, `#menu`), and each part's script (`app.js`, `presentation.js`) loads only when first chosen. Opening the presentation must never start a video download. `presentation.js` only navigates pages.
- Every screen sits on one canvas: the teal ground and soft shapes are `body` and its pseudo-elements, with white cards on top. Controls placed directly on the canvas use the `.text-on-dark` / `.deck-nav` styles. The slide diagrams are CSS connectors and one inline SVG (see the page comments in `styles.css`); they are hidden below 650px, where cards stack.
- The site's palette is sampled from the slides and lives in `:root` in `styles.css` (teal `#0f7675`/`#05726d`, orange `#e4562e`, yellow `#f6b93c`, purple `#6a4d8f`, green `#2d9f5a`, charcoal text `#1e2c2c`, and the pale mint/peach/lavender/leaf/cream card tints). Reuse those tokens; do not reintroduce the earlier lime accent or serif headings.
- Icons are inline SVG `<symbol>`s at the top of `index.html`, used through `<use href="#i-name">`. Add to that sprite rather than adding image files or emoji.
- The film's copy uses the presentation's language: the choice is *say yes* versus *say no, hang up and check*; warning signs cite the three responses; the advice page is *Stop, check, report, ask*; the closing line is *Enlightened, not frightened*. Keep the film and the presentation saying the same thing when either changes.
- `tests/presentation.test.cjs` reads the page ids from `index.html`; `tests/access.test.cjs` covers the menu, routing and on-demand script loading. Run `make test` after touching any of `index.html`, `access.js`, `presentation.js` or `app.js`.

## uv and the access page

- Use uv for Python environments and dependencies. Commit `pyproject.toml`, `uv.lock` and `.python-version`; keep `.venv` ignored. Make commands use `uv run --locked`. Pillow belongs to the optional `media` group, never normal builds.
- `requirements.txt` bootstraps only the pinned uv executable through Netlify's Python dependency installer. Keep application dependencies in `pyproject.toml` / `uv.lock`. Preserve the remote `make build` / `dist` settings, and verify a real Netlify build after changing dependency management.
- The shared code is stored nowhere in the repository or the site: entering it decrypts `speaker.enc.json` (the presenter's name, greeting, role, biography and closing line), sealed by `scripts/private.cjs` with PBKDF2-SHA256 and AES-GCM. `access.js` mirrors that derivation; keep the two in step. The plain text lives in ignored `private/speaker.json`; `make private` re-seals it and asks for the code. Never write the code or the plain-text details into any committed file, test, commit message or PR, and never commit `private/speaker.json`; tests seal their own fixture with a throwaway code. The landing page is initially visible and everything else hidden; `app.js` loads only after the film is chosen.
- The gate is not authentication: the pages and video files remain public, and a short code can be guessed offline against the sealed file. Do not describe it as private or secure access. A stronger access requirement needs a separate hosting/authentication design.
- Keep the audience in mind: visible code entry, readable error messages, large buttons and keyboard access. Do not use emoji in the interface. Use SVG or CSS shapes for play/pause icons.
- The safe-steps wording is “Wait five minutes before you call your bank.” Avoid “calling back”, which could imply returning the scammer's call.
