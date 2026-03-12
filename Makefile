.PHONY: help serve build install post-status post-commit post-push new-post list-categories

# Default target
help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Development
# ---------------------------------------------------------------------------

serve: ## Run Jekyll local server (with drafts and future posts)
	bundle exec jekyll serve --drafts --future

build: ## Build Jekyll site
	bundle exec jekyll build

install: ## Install Ruby and Node dependencies
	bundle install

# ---------------------------------------------------------------------------
# Post management
# ---------------------------------------------------------------------------

list-categories: ## List available post categories
	@bash initpost.sh -l

new-post: ## Create a new post (usage: make new-post CAT=kubernetes TITLE="My Post Title" [DATE=YYYY-MM-DD])
	@if [ -z "$(CAT)" ] || [ -z "$(TITLE)" ]; then \
		echo "Usage: make new-post CAT=<category> TITLE=\"<post title>\" [DATE=YYYY-MM-DD]"; \
		echo ""; \
		echo "Examples:"; \
		echo "  make new-post CAT=kubernetes TITLE=\"How to Deploy Helm Charts\""; \
		echo "  make new-post CAT=aws TITLE=\"S3 Lifecycle\" DATE=2026-04-01"; \
		echo ""; \
		bash initpost.sh -l; \
		exit 1; \
	fi; \
	POST_DATE=$(DATE) bash initpost.sh -c $(CAT) $(TITLE)

post-status: ## Show new, modified, and deleted posts
	@echo "=== New posts ==="
	@git ls-files --others --exclude-standard '_posts/' 2>/dev/null || true
	@echo ""
	@echo "=== Modified posts ==="
	@git diff --name-only '_posts/' 2>/dev/null || true
	@echo ""
	@echo "=== Staged posts ==="
	@git diff --cached --name-only '_posts/' 2>/dev/null || true

post-commit: ## Auto-commit post changes with generated message
	@NEW_FILES=$$({ git ls-files --others --exclude-standard '_posts/'; git diff --cached --diff-filter=A --name-only '_posts/'; } 2>/dev/null | sort -u | grep '\.md$$'); \
	MOD_FILES=$$({ git diff --name-only '_posts/'; git diff --cached --diff-filter=M --name-only '_posts/'; } 2>/dev/null | sort -u | grep '\.md$$'); \
	DEL_FILES=$$({ git ls-files --deleted '_posts/'; git diff --cached --diff-filter=D --name-only '_posts/'; } 2>/dev/null | sort -u | grep '\.md$$'); \
	ALL_FILES=""; \
	[ -n "$$NEW_FILES" ] && ALL_FILES="$$NEW_FILES"; \
	[ -n "$$MOD_FILES" ] && ALL_FILES="$$ALL_FILES $$MOD_FILES"; \
	[ -n "$$DEL_FILES" ] && ALL_FILES="$$ALL_FILES $$DEL_FILES"; \
	ALL_FILES=$$(echo "$$ALL_FILES" | xargs); \
	if [ -z "$$ALL_FILES" ]; then \
		echo "No post changes to commit."; \
		exit 0; \
	fi; \
	\
	for f in $$ALL_FILES; do \
		git add "$$f"; \
	done; \
	\
	NEW_COUNT=0; MOD_COUNT=0; DEL_COUNT=0; \
	[ -n "$$NEW_FILES" ] && NEW_COUNT=$$(echo "$$NEW_FILES" | wc -l | tr -d ' '); \
	[ -n "$$MOD_FILES" ] && MOD_COUNT=$$(echo "$$MOD_FILES" | wc -l | tr -d ' '); \
	[ -n "$$DEL_FILES" ] && DEL_COUNT=$$(echo "$$DEL_FILES" | wc -l | tr -d ' '); \
	TOTAL=$$((NEW_COUNT + MOD_COUNT + DEL_COUNT)); \
	\
	if [ "$$TOTAL" -eq 1 ]; then \
		FILE=$$(echo "$$ALL_FILES" | tr ' ' '\n' | head -1); \
		SLUG=$$(basename "$$FILE" .md | sed 's/^[0-9]*-[0-9]*-[0-9]*-//'); \
		CATEGORY=$$(echo "$$FILE" | sed 's|_posts/\([^/]*\)/.*|\1|'); \
		if [ -n "$$NEW_FILES" ] && echo "$$NEW_FILES" | grep -q "$$FILE"; then \
			MSG="posts($$CATEGORY): add $$SLUG"; \
		elif [ -n "$$DEL_FILES" ] && echo "$$DEL_FILES" | grep -q "$$FILE"; then \
			MSG="posts($$CATEGORY): remove $$SLUG"; \
		else \
			MSG="posts($$CATEGORY): update $$SLUG"; \
		fi; \
	else \
		PARTS=""; \
		[ "$$NEW_COUNT" -gt 0 ] && PARTS="add $$NEW_COUNT"; \
		[ "$$MOD_COUNT" -gt 0 ] && { [ -n "$$PARTS" ] && PARTS="$$PARTS, "; PARTS="$${PARTS}update $$MOD_COUNT"; }; \
		[ "$$DEL_COUNT" -gt 0 ] && { [ -n "$$PARTS" ] && PARTS="$$PARTS, "; PARTS="$${PARTS}remove $$DEL_COUNT"; }; \
		CATEGORIES=$$(echo "$$ALL_FILES" | tr ' ' '\n' | sed 's|_posts/\([^/]*\)/.*|\1|' | sort -u | tr '\n' ',' | sed 's/,$$//; s/,/, /g'); \
		SLUGS=$$(echo "$$ALL_FILES" | tr ' ' '\n' | xargs -I{} basename {} .md | sed 's/^[0-9]*-[0-9]*-[0-9]*-//' | tr '\n' ',' | sed 's/,$$//; s/,/, /g'); \
		MSG="posts($$CATEGORIES): $$PARTS - $$SLUGS"; \
	fi; \
	\
	echo "Commit: $$MSG"; \
	git commit -m "$$MSG"; \
	echo "Done!"

post-push: post-commit ## Auto-commit and push post changes
	git push
