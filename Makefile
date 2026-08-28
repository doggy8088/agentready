# AgentReady.js — common tasks (Bun + TypeScript toolchain)
#
#   make help        — list all targets
#   make install     — install dependencies
#   make typecheck   — strict typecheck with the latest TypeScript compiler
#   make build       — tsc emit + Bun bundle → dist/agentready.js (+ vendor copy)
#   make build-min   — minified bundle → dist/agentready.min.js
#   make test        — unit tests (bun:test + happy-dom)
#   make test-e2e    — E2E tests (Playwright, real Chrome)
#   make test-all    — typecheck + unit + e2e
#   make ci          — typecheck + build + unit + e2e (full gate)
#   make demo        — serve the demo store + test page locally
#   make clean       — remove build artifacts

SHELL := /bin/bash
PORT ?= 8788

.DEFAULT_GOAL := help

.PHONY: help install typecheck build build-min test test-e2e test-all ci demo clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies with Bun
	bun install

typecheck: ## Typecheck all TypeScript with latest tsc
	bunx tsc --noEmit

build: ## Compile TS and bundle to dist/agentready.js
	bun run build

build-min: build ## Additionally emit a minified bundle
	bun run build:min

test: ## Run unit tests
	bun run test

test-e2e: ## Run E2E tests (builds first so the bundle is fresh)
	bun run build
	bun run test:e2e

test-all: ## Typecheck + unit + E2E
	bun run test:all

ci: ## Full verification gate: typecheck → build → unit → E2E
	bun run typecheck && bun run build && bun run test && bun run test:e2e

demo: ## Serve demo store + test page at http://localhost:$(PORT)
	bun run demo

deploy-netlify: ## Deploy demo/store to Netlify (prompts for login on first run)
	bunx netlify-cli@latest deploy --dir demo/store --prod

deploy-vercel: ## Deploy demo/store to Vercel (links project on first run)
	bunx vercel@latest demo/store --prod

deploy-cloudflare: ## Deploy demo/store to Cloudflare Pages (login on first run)
	bunx wrangler@latest pages deploy demo/store --project-name agentready-demo

clean: ## Remove build artifacts
	rm -rf build dist/*.min.js