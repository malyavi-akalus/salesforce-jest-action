# salesforce-jest-action

Runs a Lightning Web Component Jest suite and reports it — as the job's verdict,
as a section of a shared pull request comment, and as the job summary.

```yaml
- uses: actions/checkout@v7

- uses: actions/setup-node@v7
  with:
    node-version: 'lts/*'
    cache: npm

- uses: malyavi/salesforce-jest-action@v1
```

That is the whole of it for a repository using `sfdx-lwc-jest`: the action
installs dependencies, runs the suite, and reports it.

## Why an action rather than three steps

The numbers come from the runner's own JSON report rather than from scraping its
console output, which means:

- **The job log stays readable.** `--json --outputFile` leaves the human
  reporter on stderr, so the log is the usual one while the numbers land in a
  file.
- **A suite that never ran is still reported.** A broken import fails a run with
  *zero* failed assertions. Reading the aggregate's `success` flag rather than
  counting failures is what stops that being reported as a pass, and lifting the
  suite's own `message` is what puts the cause in the summary.
- **A failing suite is reported before it fails the job.** The runner's exit code
  is caught, the report is written, and the failure is re-raised afterwards.
  Reversing that order is how a red run ends up with an empty comment.

## Skipping when nothing relevant changed

On a pull request, name the paths that can change the suite's result:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0

- uses: malyavi/salesforce-jest-action@v1
  with:
    paths: |
      force-app/**/lwc/**
      package.json
      jest.config.js
```

When none of them changed against the pull request's base branch, the action
installs nothing, runs nothing, reports `skipped` in the comment and the job
summary, and passes. Include the configuration that changes what the suite
does — `package.json`, `jest.config.js` — or a change to it will not be tested.

Entries use git's glob matching, so `**` crosses directories as it does in a
workflow's own `paths:` filter. An entry that starts with `:` is passed to git
as written, which is how to exclude: `:(exclude)force-app/**/legacy/**`.

The filter fails open: with no `paths`, no base branch (a push event), or a
checkout too shallow to diff, the suite runs. The base branch has to be in the
checkout, hence `fetch-depth: 0`.

## Reporting a run somebody else made

If your runner takes flags this action does not predict, run it yourself and
hand over the results file:

```yaml
- name: Run the suite
  id: suite
  continue-on-error: true
  run: npx sfdx-lwc-jest -- --json --outputFile=jest-results.json --shard=1/2

- uses: malyavi/salesforce-jest-action@v1
  with:
    run: 'false'
    results-file: jest-results.json
    test-outcome: ${{ steps.suite.outcome }}
```

`test-outcome` is only used to explain a *missing* results file: "produced no
results file (test step outcome: `failure`)" is actionable, and "produced no
results file" alone is not.

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `run` | `true` | Whether to run the suite. Off reports an existing results file. |
| `test-command` | `npx sfdx-lwc-jest` | The command that runs the suite, without its reporting flags. |
| `args` | — | Extra arguments for it, for example `--skipApiVersionCheck`. |
| `separator` | `true` | Whether to put `--` before the reporting flags. A wrapper such as `sfdx-lwc-jest` needs it; Jest called directly does not. |
| `coverage` | `false` | Whether to collect coverage. |
| `results-file` | `jest-results.json` | Where the runner writes its JSON report, relative to the working directory. |
| `test-outcome` | `unknown` | With `run: false`, the outcome of your own test step. |
| `paths` | — | Git pathspecs that decide whether the suite runs. With none changed it is skipped and reported `skipped`. Empty always runs. |
| `base-ref` | `origin/<PR base>` | What `paths` compares against. |
| `install` | `true` | Whether to install dependencies first. |
| `install-command` | `npm ci` | How to install them. |
| `fail-on-error` | `true` | Whether a failing suite fails the run. |
| `max-failures-listed` | `10` | Failed tests named in the comment before collapsing into a count. |
| `label` | `LWC Jest` | How the check names itself. Set it to the job's name so a reader can find the log. |
| `working-directory` | `.` | For a repository whose project is not at its root. |
| `comment` | `true` | Whether to write the pull request comment at all. |
| `comment-section` | `jest` | The section of the shared comment this action owns. |
| `comment-tag` | `<!-- malyavi-pr-status-comment -->` | Identifies the shared comment. Give every action reporting into one comment the same tag. |
| `comment-section-order` | — | Fixed rendering order for the sections, comma-separated. |
| `pr-number` | from the event | The pull request to comment on. |
| `github-token` | `github.token` | Used to read and write the comment. |

## Outputs

| Output | What it holds |
| --- | --- |
| `outcome` | `passed`, `failed`, or `skipped` when `paths` matched no change. |
| `tests-passed`, `tests-failed`, `tests-total`, `tests-skipped` | Counts from the run. |
| `suites` | Suites the run covered. |
| `results-path` | The JSON report, for a later step to upload as an artifact. Empty when the run was skipped. |

## The shared comment

Give every check that reports into one comment the same `comment-tag`, and each
writes only its own section:

```yaml
- uses: malyavi/salesforce-jest-action@v1
  with:
    comment-tag: '<!-- ci-status -->'
    comment-section-order: validation,jest,pmd
```

A write is read-modify-write, so two jobs finishing in the same instant can lose
one section until the next push. That is accepted: the window is milliseconds
wide and the alternative is cross-job locking for a status comment.

## Requirements

- **Node 20 or newer**, which every GitHub-hosted runner already has.
- **`pull-requests: write`** permission if you want the comment.

## Development

```bash
npm test                           # unit suite, no dependencies
python3 test/check-action-yaml.py  # action.yml parses and maps every input
```

The suite is Node's own test runner over real Jest report fixtures, including a
crashed-suite one. The smoke job in `.github/workflows/pr-validation.yml` runs
the action against an actual two-test Jest project, because nothing else proves
the flags reach the runner.
