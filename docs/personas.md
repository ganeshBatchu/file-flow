# FileFlow Persona Roadmap

FileFlow currently ships with student-tailored heuristics: course-number
detection (`CS 3100`, `MATH 1365`), build-log filenames, resume / CV / cover
letter detection, and the underlying TF-IDF + k-means clustering pipeline.

This document catalogues other user demographics that would benefit from a
local, on-device file organizer, and proposes concrete features for each. The
shape of every entry follows the same template:

- **Who** — short description of the persona.
- **Pain with the default pipeline** — why the generic clusterer alone is
  insufficient for them.
- **Proposed features** — concrete, mostly filename / extension / metadata
  rules that fit the existing module layout
  (`src/classifier/*`, `src/extractor/*`).
- **Where it lives** — module(s) likely to host the rule.
- **Sample matches** — real-world filenames the rule should fire on.

A "persona pack" can be enabled per user; multiple packs are additive. None
should fire on files outside their domain (high precision over recall — the
generic clusterer is the recall safety net).

---

## 1. Software Engineers

**Who.** Devs working on multiple repos, side projects, and downloaded
toolchains — usually have one or more big code dirs under `~/code`,
`~/projects`, or `~/dev`.

**Pain.** Current pipeline will happily walk into `node_modules`, `.git`,
`target/`, `dist/`, `__pycache__/`, `.venv/`, and either grind for minutes or
produce wildly incoherent k-means clusters where 80% of vocabulary is
package metadata. Users want FileFlow to *recognize* a code project and step
around it, not classify the contents.

**Proposed features.**

- **Project-root detection.** A directory is a "code project" if it contains
  any of: `.git/`, `package.json`, `Cargo.toml`, `pyproject.toml`,
  `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`, `composer.json`,
  `*.csproj`, `*.xcodeproj`. When detected, treat the entire subtree as a
  single opaque unit — never recurse, never classify individual files.
  Group siblings of code projects (`./project-A`, `./project-B`) under a
  parent "Code Projects" folder if requested.
- **Auto-blacklist.** Extend `src/config/exclusions.ts` with a code-aware
  preset that adds: `node_modules/`, `.git/`, `dist/`, `build/`, `target/`,
  `out/`, `bin/`, `obj/`, `__pycache__/`, `.venv/`, `venv/`, `env/`,
  `.tox/`, `.pytest_cache/`, `.next/`, `.nuxt/`, `coverage/`,
  `.gradle/`, `.idea/`, `.vscode/` (configurable), `vendor/`,
  `Pods/`, `DerivedData/`.
- **Honour `.gitignore`.** When inside a project root, parse the project's
  `.gitignore` and skip any matching files. Solves the long tail of
  build artifacts the static blacklist won't cover.
- **Loose-script grouping.** Files like `quick-test.py`, `scratch.js`,
  `notes.sh` sitting outside a project root → "Code Snippets" folder
  (extension-based, not content-based). Threshold: file < 5 KB and a
  recognized script extension.
- **Toolchain installer detection.** `.dmg`, `.pkg`, `.exe`, `.msi`, `.deb`,
  `.rpm` with names matching `node-*`, `python-*`, `*sdk*`, `*runtime*`,
  `*-installer*` → "Installers / Toolchains" instead of generic
  "Downloads".

**Where it lives.**
- New `src/classifier/code-project.ts` — detection + skip rule.
- Extend `src/config/exclusions.ts` with persona presets.
- `src/safety/dryrun.ts` short-circuits when a code-project root is hit.

**Sample matches.** `~/dev/myapp/.git/`, `~/Downloads/node-v20.10.0.pkg`,
`~/Documents/scratch.py`.

---

## 2. Researchers / Academics

**Who.** Grad students, postdocs, faculty drowning in downloaded PDFs,
preprints, and citation files. Like students but skewed heavily toward papers
rather than course materials.

**Pain.** Course-number detection doesn't fire — papers don't have course
codes. The clusterer groups by topic crudely (`Ai_Energi` is recognizable but
not actionable for someone with 800 PDFs across many subfields). Users want
*citation-keyed* organization.

**Proposed features.**

- **Citation key detection.** Filenames like `Smith2023.pdf`,
  `Hinton-et-al-2015.pdf`, `Vaswani2017_Attention.pdf` → folder per
  first-author + year. Regex: `^([A-Z][a-z]+)(?:-?et-?al)?[_\s-]?(\d{4})`.
- **arXiv ID extraction.** Names matching `\d{4}\.\d{4,5}(v\d+)?` →
  group as "arXiv Preprints" with one folder per primary category.
  Fetch metadata via the arXiv abstract page (offline-cached) for
  better folder names.
- **DOI extraction (content).** Pull DOIs from PDF text, look up the
  cached CrossRef bibliographic data, group by venue
  (e.g. "NeurIPS 2024", "Nature Methods 2023").
- **BibTeX file linking.** `.bib`, `.bibtex` files → "References" folder;
  cross-link cited keys with PDFs sharing the same key.
- **Manuscript revision chains.** `paper_v1.pdf`, `paper_v2_clean.pdf`,
  `paper_revised_final.pdf` → grouped under one "Manuscripts" folder
  with version order preserved in filename, not directory depth.
- **Conference / journal name extraction.** Common venues
  (NeurIPS, ICML, CVPR, ACL, NAACL, EMNLP, ICLR, AAAI, KDD, SIGGRAPH,
  Nature, Science, PNAS, Cell, Lancet, JAMA, NEJM, …) detected in
  filename or first-page text → top-level venue folders.

**Where it lives.**
- New `src/classifier/academic.ts` — citation regex + venue table.
- `src/extractor/document.ts` already extracts PDF text; extend to
  surface the first 5 lines as a "header" field for venue detection.

**Sample matches.** `Hinton2015_DistillingKnowledge.pdf`,
`2017.06762.pdf`, `Vaswani-et-al-2017.pdf`, `paper_revision_2.tex`.

---

## 3. Photographers

**Who.** Hobbyist or professional shooters whose `~/Pictures` is a flat dump
of camera card imports.

**Pain.** No filename signal beyond camera-default `IMG_4521.JPG`,
`DSC_0001.NEF`. The clusterer can't help — there's no extractable text.
Photographers organize by *date*, *event*, and *RAW/JPEG pairing*, not by
content.

**Proposed features.**

- **EXIF date binning.** Group by capture date from EXIF, not
  filesystem mtime (which gets clobbered by transfers). Folders
  named `YYYY-MM-DD` or `YYYY/MM`.
- **Event detection.** Cluster shots by gap-detection on capture
  timestamps: a > 6-hour gap starts a new event. Optional GPS clustering
  (radius < 5 km) refines events that span the same day.
- **Burst detection.** ≥ 5 shots within 10 seconds at the same focal
  length → "Burst" subfolder, named after the first frame.
- **RAW + JPEG pairing.** `IMG_4521.NEF` + `IMG_4521.JPG` → one
  "shot" treated as a unit, never split across folders. Same logic
  for `.cr2/.cr3/.arw/.dng/.raf` + sidecar `.xmp/.dop`.
- **Camera/lens binning (optional).** EXIF `Model` and `LensModel` fields
  → "Camera A" / "Camera B" subfolders for users with multiple bodies.
- **Trash heuristic.** EXIF `Rating` ≤ 1 or filename starts with
  `_DELETED_` → "Cull" folder, not the main library.

**Where it lives.**
- New `src/extractor/exif.ts` (use `exifr` or `piexifjs`).
- New `src/classifier/photo-events.ts`.

**Sample matches.** `IMG_4521.JPG` + `IMG_4521.NEF`,
`DSC09812.ARW`, `_MG_3401.CR2`, `R0010078.DNG`.

---

## 4. Designers / Creatives

**Who.** Visual designers working in Figma / Sketch / Adobe / Affinity, plus
illustrators and motion designers. Files mix proprietary project files,
exports, asset references, and brand kits.

**Pain.** Extension diversity (`.psd`, `.ai`, `.sketch`, `.fig`, `.afdesign`,
`.afphoto`, `.indd`, `.xd`, `.aep`) doesn't classify by content — most
formats are binary and unreadable to the text extractor. Designers want
*project ↔ exports* linkage and version chains.

**Proposed features.**

- **Project-file recognition.** Treat `.psd`, `.ai`, `.sketch`, `.fig`,
  `.indd`, `.afdesign`, `.afphoto`, `.xd`, `.aep`, `.prproj` as
  high-priority pivots — group exports near their source.
- **Project ↔ export linking.** `logo.ai` produces `logo.png`,
  `logo@2x.png`, `logo.svg`, `logo.pdf` — same stem, different
  extension, mtime within 1 hour of source → grouped as "Logo (assets)".
- **Version chains.** `mockup-v1.fig`, `mockup-v2.fig`,
  `mockup-final.fig`, `mockup-final-FINAL.fig`, `mockup-final-v3.fig`
  → grouped, version-ordered (semantic version tokens beat lexical sort).
- **Brand asset detection.** Filenames containing
  `brand`, `logo`, `style-guide`, `brand-kit`, `mark`, `wordmark`,
  `palette`, `swatches` → "Brand Assets" preserved at root of project.
- **Stock & licensed asset detection.** Filenames matching common
  stock IDs (e.g. `unsplash-*`, `pexels-*`, `iStock-*`,
  `shutterstock_*`, `adobestock_*`) → "Stock Library" with provenance
  preserved.

**Where it lives.**
- New `src/classifier/creative-assets.ts` — project file table +
  source/export pairing logic.
- Extend `src/classifier/sibling-inference.ts` to support
  same-stem-different-extension siblings (already does numeric tokens
  for courses; same idea different keying).

**Sample matches.** `logo.ai` + `logo.png` + `logo@2x.png`,
`hero-mockup-v3.fig`, `unsplash-photo-1234567.jpg`.

---

## 5. Lawyers / Legal Professionals

**Who.** Attorneys, paralegals, in-house counsel — file naming conventions
are strict (firm-mandated), and misfiling is a malpractice risk. High
sensitivity to *what* gets categorized and *where it ends up*.

**Pain.** Court documents share a stable vocabulary ("plaintiff",
"defendant", "motion to dismiss") that the clusterer would happily blur
together across unrelated matters. Users need *matter-keyed* organization,
not topic-keyed.

**Proposed features.**

- **Matter / case number extraction.** Filenames or first-page text
  matching `\d{2,4}-[A-Z]{2,3}-\d{3,6}` (e.g. `2024-CV-12345`),
  `[A-Z]{2,3}-\d{2,4}-\d{3,6}`, or `\bdocket no\.?\s*[\w-]+\b` →
  matter folder. Fed by a user-curated **matter list** so a typoed
  number doesn't spawn a phantom matter.
- **Document type classification.** High-precision filename signals:
  `complaint`, `answer`, `motion to (dismiss|compel|...)`, `brief`,
  `memorandum`, `deposition`, `affidavit`, `subpoena`, `discovery`,
  `interrogatories`, `settlement`, `retainer`, `engagement letter`,
  `nda`, `loi`, `term sheet` → typed subfolders within each matter.
- **Privilege / confidentiality flag.** Filenames containing
  `privileged`, `attorney-client`, `work product`, `confidential` →
  flagged in journal but **not** auto-moved without explicit
  confirmation (avoid accidental disclosure via unintended folder).
- **Date-stamped retention awareness.** Surface mtime + matter status
  in the UI so users can spot files older than the firm's retention
  window.
- **Bates-stamped discovery support.** `BATES_001234.pdf` → "Discovery
  / Production" with a sequence preserved.

**Where it lives.**
- New `src/classifier/legal.ts`.
- Extend `src/config/schema.ts` with `legal_matters: { number, name }[]`.

**Sample matches.** `2024-CV-12345_Smith_v_Jones_Motion to Dismiss.pdf`,
`Doe-001234-Discovery.pdf`, `Engagement Letter - Acme Corp.docx`.

---

## 6. Accountants / Finance Professionals

**Who.** Tax preparers, bookkeepers, CFOs, individual filers with multiple
years of records.

**Pain.** Tax documents follow rigid form-naming (`W-2`, `1099-INT`, `K-1`,
`1040`) that the clusterer treats as opaque. Users want *tax year* /
*entity* / *form type* organization.

**Proposed features.**

- **Tax-year extraction.** Filenames or content matching
  `\b(20\d{2})\b` near tax-form keywords → year folder. Prefer
  filename signal (`W2_2024.pdf`) over content (some forms reference
  multiple years).
- **Form-type classification.** Strict regex on `W[\s_-]?2`,
  `1099[\s_-]?(INT|DIV|MISC|NEC|R|B|G|K|S)`, `K[\s_-]?1`,
  `1040(?:[\s_-]?(EZ|SR|X|NR))?`, `Schedule\s+[A-K]`, `1098(?:[\s_-]?T)?`,
  `5498`, `8606`, `4868` → typed subfolders.
- **Quarter / period detection.** `Q1_2024`, `2024Q1`, `2024-03` →
  quarterly subfolders for entity bookkeeping.
- **Statement type (banking).** "Bank Statement", "Credit Card
  Statement", "Brokerage Statement", "Mortgage Statement" → typed
  buckets, ordered by date in filename or content.
- **Receipt categorization.** OCR receipts (already supported via
  the OCR placeholder) → expense categories from merchant name table
  (food, travel, supplies, software, …). Off by default — this is
  judgement-heavy and false positives matter.
- **Multi-entity awareness.** Config carries an `entities: string[]`
  list (filer name, business name, spouse, dependents); files matching
  an entity name go into that entity's subtree first, then subdivided
  by year/form.

**Where it lives.**
- New `src/classifier/financial.ts`.
- Extend `src/config/schema.ts` with `financial_entities`.

**Sample matches.** `W-2_2024_Acme_Corp.pdf`, `1099-NEC_2023.pdf`,
`Schedule K-1 - Smith Family Trust 2023.pdf`,
`BankStatement_Chase_2024-03.pdf`.

---

## 7. Writers / Authors

**Who.** Novelists, nonfiction authors, screenwriters. One project might
sprawl across hundreds of revision files, research notes, and submission
drafts.

**Pain.** Writers move through many revisions of the same chapter; the
clusterer would group all chapters of a novel into one big "novel" cluster,
losing the chapter / revision structure that's meaningful to the writer.

**Proposed features.**

- **Manuscript revision chains.** Same-stem-different-suffix siblings
  (`ms_v1.docx`, `ms_v2.docx`, `ms_revisions.docx`,
  `ms_revisions_clean.docx`) → revision-ordered manuscript folder.
- **Chapter detection.** `ch01_*.docx`, `chapter_1_*.md`,
  `01-the-beginning.md` → ordered chapters per project.
  Disambiguate chapters across projects by the parent directory name
  or a project-name token in the filename.
- **Submission packet awareness.** Filenames containing `query`,
  `synopsis`, `partial`, `full`, `proposal`, `cover-letter` (writer
  context, not job context) → "Submissions" with one subfolder per
  agent / publisher inferred from filename token.
- **Reference / research separation.** Files in a project folder that
  are not the manuscript — `notes`, `research`, `worldbuilding`,
  `outline`, `beat-sheet`, `character-sheet` filenames → "Reference"
  subfolder.
- **Word-count aware sorting.** Surface word counts (cheap to compute
  for `.docx` / `.md` / `.txt`) in the UI so writers can spot
  abandoned vs. active drafts.

**Where it lives.**
- New `src/classifier/manuscript.ts`.
- Extend `src/extractor/document.ts` to surface word count.

**Sample matches.** `novel_v3_revisions.docx`, `ch07_the-confrontation.md`,
`outline_act-2.docx`, `query - The Lighthouse Keeper.pdf`.

---

## 8. Data Scientists / ML Engineers

**Who.** Practitioners juggling notebooks, datasets, model checkpoints, and
experiment artifacts. Adjacent to software engineers but distinct enough to
deserve a pack.

**Pain.** Notebooks (`.ipynb`) carry massive embedded base64 image output;
the tokenizer chokes and the clusterer gets noise. Datasets are huge and
should never be classified by content. Model checkpoints have version-aware
sibling structure (`model.pt`, `model_best.pt`, `model_epoch_42.pt`).

**Proposed features.**

- **Notebook handling.** `.ipynb` → strip output cells before
  tokenization (the source code carries the meaning, not the
  rendered plots). Group notebooks by leading numeric prefix
  (`01_eda.ipynb`, `02_train.ipynb`) into "Notebooks (ordered)".
- **Dataset detection.** `.csv`, `.parquet`, `.tsv`, `.jsonl`, `.h5`,
  `.hdf5`, `.npy`, `.npz`, `.feather`, `.arrow`, `.zarr/` larger than
  N MB → "Datasets" with no content extraction (skip text pipeline).
  Group by stem similarity (`train.csv`, `val.csv`, `test.csv`).
- **Model checkpoint grouping.** Filenames matching
  `\b(model|checkpoint|ckpt|epoch)\b.*\.(pt|pth|safetensors|onnx|pb|h5|bin)$`
  → "Model Checkpoints" with version order from epoch / step / date.
  Single "best" model surfaced separately.
- **Experiment-run grouping.** Files with a shared
  `run_<id>` / `experiment_<id>` / `wandb-<id>` prefix → one folder
  per run; figures, configs, and results stay together.
- **Auto-blacklist.** `__pycache__/`, `.ipynb_checkpoints/`, `mlruns/`,
  `wandb/`, `lightning_logs/`, `checkpoints/`, `outputs/`, `runs/`,
  `tb_logs/`, `.dvc/`.

**Where it lives.**
- New `src/classifier/ml-artifacts.ts`.
- Extend `src/extractor/index.ts` to detect `.ipynb` and route to a
  custom code-only extractor.

**Sample matches.** `01_eda.ipynb`, `train.csv` + `val.csv` + `test.csv`,
`model_best.pt`, `run_20240315_142211/config.yaml`.

---

## 9. Job Seekers / Career Pivoters

**Who.** People in active search mode tailoring per application — a richer
version of the existing student "Personal" heuristic.

**Pain.** Resume + cover letter chains explode quickly:
`Resume_Acme.pdf`, `Resume_Bertz.pdf`, `Resume_Acme_v2.pdf`,
`CoverLetter_Acme.docx`. The current heuristic dumps all into one "Personal"
folder, losing the per-company grouping.

**Proposed features.**

- **Per-company grouping.** Resume / cover letter filenames with a
  trailing company token → folder per company under "Job Search".
  Inferred company token = whichever capitalised word in the filename
  isn't `Resume`, `CV`, `Cover`, `Letter`, etc.
- **Resume version chains.** Multiple resumes for one company →
  date-ordered version chain, latest surfaced.
- **Job-description pairing.** `JD_Acme_SeniorEng.pdf`,
  `JobDescription-Acme.pdf` → live next to the matching resume.
- **Reference-letter awareness.** `Reference_*`, `Recommendation_*`,
  `LOR_*` → "References" subfolder, source author preserved.
- **Application tracker (optional).** Lightweight CSV view in the UI:
  per-company status, dates, file links — read directly from the
  organized structure.

**Where it lives.**
- Extend `src/classifier/filename-heuristics.ts` —
  `Personal` becomes more granular: `Personal/Job Search/Acme Inc/`
  vs. the current flat `Personal/`.

**Sample matches.** `Ganesh_Resume_Stripe.pdf`,
`Cover Letter - Anthropic.docx`, `JD_Anthropic_RE.pdf`,
`Reference - Prof. Smith.pdf`.

---

## 10. General Office / Knowledge Workers

**Who.** The "Downloads-as-default" majority — meeting notes, slide decks,
contracts, expense receipts, miscellaneous attachments.

**Pain.** No domain-specific naming, but predictable *artefact types*: a
slide deck is a slide deck whether it's HR or engineering. Users mostly
want a clean date-and-type bucket.

**Proposed features.**

- **Artefact-type buckets.** Extension-based first pass:
  `*.pptx`/`*.key` → "Presentations"; `*.xlsx`/`*.numbers` →
  "Spreadsheets"; `*.docx`/`*.pages` → "Documents"; `*.pdf` falls to
  finer logic.
- **Meeting-notes detection.** Filenames containing
  `meeting`, `1on1`, `1-1`, `standup`, `retro`, `planning`, `kickoff`,
  `notes` plus a date token → "Meetings/YYYY-MM/" with date prefix
  preserved.
- **Email attachment provenance.** Some platforms prefix downloaded
  attachments with the sender domain (`from-acme-com_proposal.pdf`)
  or include `Re:` / `Fwd:` tokens → preserve sender as a
  classification hint.
- **Receipt / invoice detection.** Filenames containing
  `receipt`, `invoice`, `inv-`, `paid`, `transaction` → "Receipts"
  with year/month subfolders. Light overlap with the Accountants pack
  but tuned for individual rather than entity context.
- **Calendar export awareness.** `.ics` files, names matching
  `*invitation*` or `*meeting-invite*` → "Calendar".

**Where it lives.**
- Extend `src/classifier/filename-heuristics.ts` with extension
  buckets (after course / persona-specific rules, before TF-IDF).

**Sample matches.** `Q4 Planning - 2024-10-15.pptx`,
`Standup Notes - 2024-11-04.docx`, `Invoice_INV-2024-0042.pdf`.

---

## Cross-cutting infrastructure

These features are not persona-specific but make the persona model usable.

### Persona packs

Configuration shape:

```json
{
  "personas": ["software-engineer", "researcher"],
  "exclusions": [...],
  "categories": {...}
}
```

Each pack contributes:
- a list of additional **exclusion globs**,
- a list of **filename / content classifiers** registered in priority
  order,
- optional **schema extensions** (e.g. `legal_matters`,
  `financial_entities`) used by that pack's classifier.

The pipeline runs all enabled packs' classifiers in declared priority
before falling back to TF-IDF, mirroring how courses + heuristics
currently run before the clusterer.

### Persona auto-detection (suggestion-only)

On first launch / on demand, scan the user's watch directories and
surface a "Looks like you might be: ☑ Software Engineer  ☑ Researcher"
prompt. Detection signals:

- Software engineer: ≥ 3 directories containing `package.json` /
  `Cargo.toml` / `go.mod` etc.
- Researcher / academic: ≥ 20 PDFs whose filenames match the
  citation-key regex.
- Photographer: ≥ 50 RAW files (`.cr2/.nef/.arw/.dng/.raf`).
- Designer: ≥ 5 project files among `.psd/.ai/.sketch/.fig/.aep`.
- Data scientist: ≥ 5 `.ipynb` files OR a `mlruns/` / `wandb/`
  directory.

Detection only **suggests** — never auto-enables a pack.

### Custom rule editor

Power users want to define their own filename → folder rules without
forking the code. Add a UI form on the Categories page:

```
[Pattern]  ^Project-(\w+)_      [Goes to]  Projects/$1/
```

Stored as `custom_rules: { pattern: string, destination: string }[]`
in config, applied after persona classifiers, before TF-IDF.

### Per-persona test corpora

Each pack ships a small `tests/personas/<persona>/fixtures/` directory
with a curated set of representative filenames + expected classifications,
asserted against in CI. This prevents a future change to the clusterer
from regressing a persona's precision.

---

## Implementation roadmap

Tiered by effort / impact:

**Tier 1 — high impact, low effort (filename-only rules).**
- Software Engineers (project-root detection + auto-blacklist)
- Job Seekers (per-company grouping)
- General Office (artefact-type buckets)

**Tier 2 — moderate effort (small content extraction additions).**
- Researchers (citation key + arXiv + DOI)
- Writers (revision chains, chapter detection)
- Accountants (form-type classification)

**Tier 3 — needs new extractors / metadata libraries.**
- Photographers (EXIF: needs `exifr`)
- Data Scientists (notebook output stripping)
- Designers (binary project-file metadata where possible)

**Tier 4 — sensitive domains, needs careful UX.**
- Lawyers (high cost of misfiling — confirm flow, not auto-move)
- Medical / clinical (out of scope until HIPAA review)

The persona model (packs + auto-detection + custom rules) is a Tier 1
prerequisite that should land before any individual pack so each new
persona is a clean addition rather than a layered hack on the
existing course / heuristic logic.
