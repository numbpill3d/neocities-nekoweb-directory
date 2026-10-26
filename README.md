# neocities / nekoweb directory

a brutalist, auto-updating directory of Neocities and Nekoweb sites.
macintosh chrome. linux rice. terminal bbs core.

live: https://numbpill3d.github.io/neocities-nekoweb-directory/

## what it is
- a browsable directory of indie sites
- a json endpoint other people can consume (`data/sites.json`)
- community submissions via GitHub issues

## how it updates
- workflow: `.github/workflows/update.yml` (daily)
- script: `scripts/update_data.py` (fetches metadata, regenerates `sites.json` + prerender)

## submit a site
open an issue using the "Submit a site" template. an action validates the URL,
rejects duplicates, commits the entry directly to the directory, and triggers a
data refresh. no PR review required.

## local dev
open `index.html` in a browser.
