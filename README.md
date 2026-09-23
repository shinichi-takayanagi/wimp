# WIMP

[![Test and deploy](https://github.com/shinichi-takayanagi/wimp/actions/workflows/pages.yml/badge.svg)](https://github.com/shinichi-takayanagi/wimp/actions/workflows/pages.yml)
![JavaScript](https://img.shields.io/badge/JavaScript-ES%20modules-f1e05a)

WIMP is a browser-based tool for projecting monthly financial asset balances from spending, employment income, pension income, and an assumed investment return. It uses no external libraries or server-side processing.

## Run locally

Run the following command in this directory, then open <http://localhost:8000>.

```sh
python3 -m http.server 8000
```

The app can also be deployed as-is to any static file host.

## Deployment

On each push to `main`, GitHub Actions runs the simulation tests and deploys to GitHub Pages only if they pass. The same tests run for pull requests targeting `main`. The published site consists of `index.html`, `styles.css`, `app.mjs`, and `engine.mjs`.

Live site: <https://shinichi-takayanagi.github.io/wimp/>

## Projection assumptions

- Each month, the simulation calculates investment gains or losses on the assets at the start of the month, adds employment and pension income, and subtracts spending.
- When income exceeds spending, the difference is added to financial assets. When spending exceeds income, assets are withdrawn. Any remaining deficit after assets are depleted is also recorded.
- The assumed investment return and inflation rate are converted to compounded monthly rates. A spending change takes effect in the month the specified age is reached.
- Pension is modeled as a fixed monthly amount starting at the specified claiming age. The simulation does not model actual payment frequency, taxes, social insurance premiums, or benefit changes from early or delayed claiming. Enter estimated take-home amounts.
- Projection settings are saved automatically in the browser. Monthly data can be downloaded as CSV, and the chart as PNG.

## Tests

```sh
node --test engine.test.mjs
```
