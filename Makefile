# AgentReady.js — common tasks (Bun + TypeScript toolchain)
#
#   make help        — list all targets
#   make install     — install dependencies
#   make typecheck   — strict typecheck with the latest TypeScript compiler
#   make types       — emit TypeScript declaration files (.d.ts) to dist/
#   make build       — tsc emit + Bun bundle → dist/agentready.js (+ vendor copy)
#   make build-min   — minified bundle → dist/agentready.min.js
#   make size        — analyze and check bundle sizes
#   make test        — unit tests (bun:test + happy-dom)
#   make test-e2e    — E2E tests (Playwright, real Chrome)
#   make test-all    — typecheck + unit + e2e
#   make check       — quick check: typecheck + test + size
#   make ci          — full gate: typecheck → types → build → unit → size → e2e
#   make demo        — serve the demo store + test page locally
#   make release-tag — tag and push a new release (usage: make release-tag TAG=v0.1.0)
#   make clean       — remove build artifacts

SHELL := /bin/bash
PORT ?= 8788

.DEFAULT_GOAL := help

.PHONY: help install typecheck types build build-min size test test-e2e test-all check ci demo footage video studio release-tag clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies with Bun
	bun install

typecheck: ## Typecheck all TypeScript with latest tsc
	bunx tsc --noEmit

types: ## Emit TypeScript declaration files (.d.ts) to dist/
	bun run build:types

build: ## Compile TS and bundle to dist/agentready.js
	bun run build

build-min: build ## Additionally emit a minified bundle
	bun run build:min

size: ## Analyze and check bundle sizes against limits
	bun run size

test: ## Run unit tests
	bun run test

test-e2e: ## Run E2E tests (builds first so the bundle is fresh)
	bun run build
	bun run test:e2e

test-all: ## Typecheck + unit + E2E
	bun run test:all

check: ## Quick check: typecheck + test + size
	bun run check

ci: ## Full verification gate: typecheck → types → build → min → unit → size → E2E
	bun run ci

demo: ## Serve demo store + test page at http://localhost:$(PORT)
	bun run demo

footage: ## Re-capture real product footage + narration into video/public/
	bun scripts/capture-footage.ts
	bun scripts/generate-narration.ts

video: ## Render the demo video (video/out/agentready-demo.mp4)
	cd video && bunx remotion render AgentReadyDemo out/agentready-demo.mp4

studio: ## Open Remotion Studio for the video project
	cd video && bunx remotion studio --no-open

deploy-netlify: ## Deploy demo/store to Netlify (prompts for login on first run)
	bunx netlify-cli@latest deploy --dir demo/store --prod

deploy-vercel: ## Deploy demo/store to Vercel (links project on first run)
	bunx vercel@latest demo/store --prod

deploy-cloudflare: ## Deploy demo/store to Cloudflare Pages (login on first run)
	bunx wrangler@latest pages deploy demo/store --project-name agentready-demo

release-tag: ## Tag and push a release (make release-tag TAG=v0.1.0)
	@if [ -z "$(TAG)" ]; then echo "Error: TAG is required. Usage: make release-tag TAG=v0.1.0"; exit 1; fi
	git tag -a $(TAG) -m "Release $(TAG)"
	git push origin $(TAG)
	@echo "✅ Pushed $(TAG). GitHub Actions release workflow triggered!"

clean: ## Remove build artifacts
	rm -rf build dist/*.min.js dist/*.d.ts dist/agentready-types.tar.gz