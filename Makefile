# Optional shortcuts; every target is also an npm script (use those on Windows).
.PHONY: demo test app assets
demo: ; npm run demo
test: ; npm test && npm run test:equations
app: ; npm run app
assets: ; npm run assets
