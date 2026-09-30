# Aliasy pro lidi, co radeji pouzivaji make. Vse je v package.json scriptech.
.PHONY: setup smoke test typecheck demo run batch

setup:
	bash scripts/setup.sh

smoke:
	pnpm smoke

test:
	pnpm test

typecheck:
	pnpm typecheck

demo:
	pnpm demo

# make run ID=absence-request RECIPE=samples/recipe.absence-request.json ARGS="--to mux"
run:
	@test -n "$(ID)" || (echo "usage: make run ID=<id> [RECIPE=path] [ARGS='--from record']"; exit 1)
	pnpm pipeline run --id $(ID) $(if $(RECIPE),--recipe $(RECIPE),) $(ARGS)

batch:
	pnpm batch $(ARGS)
