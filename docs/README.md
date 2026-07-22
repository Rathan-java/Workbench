# Documentation

Two PDFs, both generated from the HTML sources in [`src/`](src/).

| File | What it is |
| --- | --- |
| **Ara-Workbench-Playbook.pdf** | 17 pages. What the system is, how to run it, a day in the life of each role, a module-by-module reference, the rules it refuses to bend, the AI analyser, the scheduled jobs, security posture, and an operations runbook. |
| **Ara-Workbench-Flowcharts.pdf** | 24 pages — one diagram per module, plus the request lifecycle, access scope, the logging cadence, the scheduled jobs, and the data-preservation contract. |

## Regenerating them

```bash
cd docs/src
npm install mermaid      # once — 3.5 MB of build tooling, so it is not committed
node build.mjs
```

Chrome (or Edge) headless does the printing, so the PDF looks exactly like the HTML
in a browser — there is no second rendering engine to disagree with the first.
Mermaid runs as ordinary page JavaScript; `--virtual-time-budget` is what gives it
time to finish laying out before the snapshot is taken.

Edit `playbook.html`, `flowcharts.html` or the shared `doc.css`, then re-run
`build.mjs`. The PDFs are written to this folder.

### Two paged-media traps, both already handled in `doc.css`

- **A full-height box must not be `100%` or `100vh`.** In paged media those measure
  the whole sheet, margins included, so a "one page tall" box overflows by exactly
  the margin and emits a blank page after every single one. `--page-h` is set per
  document to the real printable height, a few millimetres under the exact figure —
  a box that lands precisely on the boundary still rounds onto the next sheet.
- **Nothing may render after the last page.** The `<script>` and `<style>` tags live
  in the head rather than at the end of the body: whitespace text nodes trailing the
  final page form a line box, and that line box becomes a blank final page.

Both were found by counting pages with a PDF parser rather than by eye — worth
repeating if you add pages and the count looks one too high.
