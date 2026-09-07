.DEFAULT_GOAL := help
UV ?= uv
PORT ?= 8000

.PHONY: help about run stop build test

help: ## Show the available commands
	@printf '%s\n' 'Check the Caller' '' '  make help    Show these commands' '  make about   Explain the site and requirements' '  make run     Build and open the site locally' '  make stop    Stop all preview servers for this project' '  make build   Package the site into dist/ for Netlify Drop' '  make test    Run player, access and packaging checks' '' 'Optional: make run PORT=8080' 'Requires uv and Make; uv manages Python. Tests also use Node.js.'

about: ## Explain the project
	@printf '%s\n' 'Check the Caller is an interactive film with a shared-code entry page.' 'The story pauses at 30 seconds and waits for a choice.' 'Each choice plays its matching video from 30 seconds.' 'At the end, viewers can watch the alternative ending or restart.' '' 'The site uses plain HTML, CSS and JavaScript, with the supplied videos.' 'uv manages Python and the optional media tools through pyproject.toml and uv.lock.' 'The dist/ folder is a self-contained static site for Netlify Drop.'

run: ## Build, serve and open the local site
	@$(UV) run --locked scripts/site.py run --port $(PORT)

stop: ## Stop every running preview belonging to this project
	@$(UV) run --locked scripts/site.py stop

build: ## Create the deployable dist folder
	@$(UV) run --locked scripts/site.py build

test: ## Check the player, access page and packaging
	@node --test tests/*.test.cjs
	@$(UV) run --locked python -m unittest discover -s tests -p 'test_*.py'
