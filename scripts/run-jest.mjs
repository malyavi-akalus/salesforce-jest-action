import {commentConfig, updateCommentSection}                               from '../lib/comment.mjs';
import {globPathspec, resolveConfig, shouldRun, testArgs}                  from '../lib/config.mjs';
import {error, setOutput, summary, warn}                                   from '../lib/core.mjs';
import {changedPaths, runCommandLine}                                      from '../lib/exec.mjs';
import {failureMessage}                                                    from '../lib/inputs.mjs';
import {renderComment, renderMissingResults, renderSkipped, renderSummary} from '../lib/report.mjs';
import {readResults, summarize}                                            from '../lib/results.mjs';

/**
 * Runs a Jest suite and reports it: as this job's verdict, as a section of the
 * shared pull request comment, and as the job summary.
 *
 * The run's own exit code decides the outcome; everything after it is
 * reporting, and reporting never changes a verdict. A green run that could not
 * be summarized is still green, and a red one whose failures could not be read
 * is still red — with the log named, because that is all there is to go on.
 */

/**
 * Installs, runs, reports.
 *
 * @return {Promise<void>}
 */
async function main() {
  const config = resolveConfig();
  const comment = commentConfig();

  if (!shouldRun(config, await changesUnderPaths(config))) {
    console.log(`Nothing under ${config.paths.join(', ')} changed; skipping the suite.`);
    await updateCommentSection(config.section, renderSkipped(config), comment);
    await summary(`## :fast_forward: ${config.label} skipped\n\nNo changes under ${config.paths.join(', ')}.`);
    // No results file exists to point at, and an upload step reading one would fail.
    await publish({outcome: 'skipped', results: null, resultsPath: ''});
    return;
  }

  let outcome = config.testOutcome;
  if (config.run) {
    outcome = await runSuite(config);
  }

  const results = await readResults(config.resultsPath);
  if (!results) {
    // No file means the runner stopped before writing one — a configuration or
    // module-resolution failure rather than a test failure. There are no
    // numbers to report, so point at the log.
    await updateCommentSection(config.section, renderMissingResults({
      label: config.label,
      outcome,
      path: config.resultsFile
    }), comment);
    await publish({outcome: 'failed', results: null, resultsPath: config.resultsPath});
    if (config.failOnError) {
      error(`${config.label}: the run produced no results file at ${config.resultsFile}.`);
      process.exitCode = 1;
    }
    return;
  }

  await updateCommentSection(config.section, renderComment(results, config), comment);
  await summary(renderSummary(results, config));

  const counts = summarize(results);
  await publish({outcome: counts.ok ? 'passed' : 'failed', results, resultsPath: config.resultsPath});

  if (!counts.ok) {
    const message = `${config.label}: ${counts.failed} of ${counts.total} test(s) failed.`;
    if (config.failOnError) {
      error(message);
      process.exitCode = 1;
    } else {
      warn(`${message} \`fail-on-error\` is off, so this does not fail the run.`);
    }
  }
}

/**
 * The changed paths that match the `paths` filter, read from git.
 *
 * Null rather than an empty list when there is nothing to compare, or the
 * comparison failed — typically a shallow checkout that lacks the base — so
 * that `shouldRun` can tell "nothing changed" from "could not tell".
 *
 * @param {object} config Resolved configuration
 * @return {Promise<string[]|null>} Matching changed paths, or null when they could not be determined
 */
async function changesUnderPaths(config) {
  if (!config.run || config.paths.length === 0 || !config.baseRef) {
    return null;
  }
  try {
    const pathspecs = config.paths.map(globPathspec);
    return await changedPaths(config.baseRef, 'HEAD', pathspecs, {cwd: config.cwd, relative: true});
  } catch (thrown) {
    warn(
      `Could not diff against ${config.baseRef} (${thrown.message}); running the suite. ` +
      'The `paths` filter needs the base branch in the checkout — use `fetch-depth: 0`.'
    );
    return null;
  }
}

/**
 * Installs the dependencies and runs the suite.
 *
 * The runner's non-zero exit is caught rather than thrown: a failing suite is
 * an expected outcome of this action, and the report has to be written before
 * the run is failed. The exit code is turned back into a failure at the end of
 * `main`, from the results the runner wrote.
 *
 * @param {object} config Resolved configuration
 * @return {Promise<string>} `success` or `failure`
 */
async function runSuite(config) {
  if (config.install) {
    await runCommandLine(config.installCommand, [], {cwd: config.cwd});
  }

  try {
    // `--json --outputFile` leaves the human reporter on stderr, so the job log
    // stays readable while the numbers land in a file.
    await runCommandLine(config.testCommand, testArgs(config), {cwd: config.cwd});
    return 'success';
  } catch (thrown) {
    console.log(`The test command exited with code ${thrown.exitCode ?? '?'}; reporting what it wrote.`);
    return 'failure';
  }
}

/**
 * Publishes the action's outputs.
 *
 * @param {{ outcome: string, results: object|null, resultsPath: string }} result What the run produced
 * @return {Promise<void>}
 */
async function publish({outcome, results, resultsPath}) {
  const counts = results ? summarize(results) : {passed: 0, failed: 0, total: 0, skipped: 0, suites: 0};
  await setOutput('outcome', outcome);
  await setOutput('tests-passed', counts.passed);
  await setOutput('tests-failed', counts.failed);
  await setOutput('tests-total', counts.total);
  await setOutput('tests-skipped', counts.skipped);
  await setOutput('suites', counts.suites);
  await setOutput('results-path', resultsPath);
}

try {
  await main();
} catch (thrown) {
  error(failureMessage(thrown));
  await setOutput('outcome', 'failed');
  process.exitCode = 1;
}
