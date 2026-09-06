# Check the Caller

This is the static fraud-awareness site in `glassmagic/checkthecaller`, aimed at older viewers. It uses plain HTML, CSS and JavaScript plus two supplied videos. Keep the large text, clear controls, 30-second choice, both endings and optional commentary replay. Keep explanations over the film and avoid automatic page scrolling.

## GitHub workflow

- The empty repository was bootstrapped with the finished site on `main`. All subsequent work uses a feature branch and a pull request.
- The user reviews and merges PRs on GitHub. Do not merge or push changes directly to `main` unless explicitly asked.
- Open PRs ready for review, not draft. Follow-up requests for an open PR can use additional commits on the same branch; keep its description current.
- After the user says a PR is merged, switch to `main`, pull with `--ff-only`, fetch with `--prune`, and remove the merged local branch if safe.
- Keep the repository public as configured. Do not change its visibility without an explicit request.

## Netlify deployment

- This project uses Netlify's native GitHub integration, like Playgraze. Merges into `main` trigger production builds; pull requests receive Deploy Previews. GitHub Actions is not needed to deploy.
- Netlify project: `checkthecaller`, team `adampowell-is`, site ID `bbc760d7-a824-4ee4-9035-3de1f74e4ac3`. Production: `https://checkthecaller.netlify.app`. PR previews: `https://deploy-preview-<PR number>--checkthecaller.netlify.app`.
- Build settings live in Netlify: production branch `main`, build command `make build`, publish directory `dist`, no base directory.
- Never publish the repository root. `scripts/site.py` copies only approved public files into `dist`.
- Keep `.netlify/`, generated `dist/`, `.preview-servers/`, `.mcp_memory/`, environment files and Python caches out of Git.
- The local Netlify link is stored in ignored `.netlify/state.json`. Read the site ID there; never copy Playgraze's ID or modify its deployment.
- GitHub repository events are delivered to Netlify by a webhook for `push`, `pull_request` and `delete`. Preserve this hook when changing deployment settings.
- Preserve Netlify hosting. Do not register or deploy this project with another hosting service unless the user asks.
- The original videos are currently under GitHub's regular Git per-file size limit and are tracked directly. Do not silently replace them, convert them to LFS pointers or include duplicate copies from `dist`.

## Work and checks

- `make help`, `make about`, `make run`, `make stop` and `make build` are the supported commands. `make run PORT=8080` selects another port.
- `make stop` shuts down project preview servers only. `tests/preview_integration.py` also stops all project previews; do not run it casually during unrelated changes.
- For playback changes, run `node --test tests/player.test.cjs`. For packaging/server changes, run `python3 -m unittest discover -s tests -p 'test_*.py'`.
- Run `make build` and `git diff --check` before delivery. Describe the checks actually performed; simulated media tests do not establish real-browser playback.
- Check the Netlify deploy record for real build errors, and verify the matching commit when reporting a deployment as ready. Do not treat a local build or successful Git push as proof of deployment.
- Commentary cue times refer to the original unsafe video. Update them only against the dialogue, not by guessing.
