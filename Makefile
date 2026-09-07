.DEFAULT_GOAL := help
PYTHON ?= python3
PORT ?= 8000

.PHONY: help about run stop build

help: ## Show the available commands
	@printf '%s\n' 'Check the Caller' '' '  make help    Show these commands' '  make about   Explain the site and requirements' '  make run     Build and open the site locally' '  make stop    Stop all preview servers for this project' '  make build   Package the site into dist/ for Netlify Drop' '' 'Optional: make run PORT=8080' 'Requires Python 3.9+; no npm install is needed.'

about: ## Explain the project
	@printf '%s\n' 'Check the Caller is a single-page interactive film.' 'The story pauses at 30 seconds and waits for a choice.' 'Each choice plays its matching video from 30 seconds.' 'At the end, viewers can watch the alternative ending or restart.' '' 'The site uses plain HTML, CSS and JavaScript, with the supplied videos.' 'Python 3.9+ is used only to build and preview it locally.' 'The dist/ folder is a self-contained static site for Netlify Drop.'

run: ## Build, serve and open the local site
	@$(PYTHON) scripts/site.py run --port $(PORT)

stop: ## Stop every running preview belonging to this project
	@$(PYTHON) scripts/site.py stop

build: ## Create the deployable dist folder
	@$(PYTHON) scripts/site.py build
