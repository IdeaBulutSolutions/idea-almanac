# Input PDF naming convention

Drop official Salesforce release-notes PDFs into this directory. **They are gitignored and never committed.**

Filename: `v{NN}-{season}{yy}.pdf`

- `NN` — two-digit API version (e.g. `55`)
- `season` — lowercase `spring` | `summer` | `winter`
- `yy` — two-digit release year as printed on the PDF title page

Examples: `v55-summer22.pdf`, `v67-summer26.pdf`, `v59-winter24.pdf`

The pipeline refuses files that don't match this pattern and cross-checks the
version against the PDF title-page text. The PDFs are ground truth for the
version↔release mapping (`data/releases.yaml`).
