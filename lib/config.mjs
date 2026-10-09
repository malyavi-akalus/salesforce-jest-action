import {isAbsolute, join}                                    from 'node:path';
import {argsInput, booleanInput, input, intInput, listInput} from './inputs.mjs';

/**
 * The action's inputs, resolved into one object.
 *
 * The shape worth noticing is `run`: this action both runs a suite and reports
 * one, and those are separable. A caller whose runner takes flags nothing here
 * predicts can run it themselves and hand over the results file, which is what
 * `run: false` is for.
 */

/**
 * Resolves every input.
 *
 * @return {{
 *   run: boolean,
 *   install: boolean,
 *   installCommand: string,
 *   testCommand: string,
 *   args: string[],
 *   separator: boolean,
 *   coverage: boolean,
 *   resultsFile: string,
 *   resultsPath: string,
 *   testOutcome: string,
 *   paths: string[],
 *   baseRef: string,
 *   failOnError: boolean,
 *   label: string,
 *   maxListed: number,
 *   section: string,
 *   cwd: string
 * }} Resolved configuration
 */
export function resolveConfig() {
  const cwd = input('working-directory', '.');
  const resultsFile = input('results-file', 'jest-results.json');

  return {
    run: booleanInput('run', true),
    install: booleanInput('install', true),
    installCommand: input('install-command', 'npm ci'),
    testCommand: input('test-command', 'npx sfdx-lwc-jest'),
    args: argsInput('args'),
    separator: booleanInput('separator', true),
    coverage: booleanInput('coverage', false),
    resultsFile,
    resultsPath: isAbsolute(resultsFile) || cwd === '.' ? resultsFile : join(cwd, resultsFile),
    testOutcome: input('test-outcome', 'unknown'),
    paths: listInput('paths'),
    baseRef: resolveBaseRef(),
    failOnError: booleanInput('fail-on-error', true),
    label: input('label', 'LWC Jest'),
    maxListed: intInput('max-failures-listed', 10),
    section: input('comment-section', 'jest'),
    cwd
  };
}

/**
 * The ref the changed-path filter compares against.
 *
 * The target branch tip, not the merge base, for the same reason as in the PMD
 * action: the checkout of a pull request is the merge result, so a change that
 * landed on the target since the merge base would otherwise count as this one's.
 *
 * @return {string} The base ref, or an empty string when the event names none
 */
export function resolveBaseRef() {
  const explicit = input('base-ref');
  if (explicit) {
    return explicit;
  }
  const baseBranch = (process.env.GITHUB_BASE_REF || '').trim();
  return baseBranch ? `origin/${baseBranch}` : '';
}

/**
 * A `paths` entry as git reads it: with glob semantics, so that `**` crosses
 * directories the way it does in a workflow's own `paths:` filter.
 *
 * Without the magic, git's default matching has no zero-directory `**`, so a
 * pattern with a directory wildcard in the middle misses a file sitting one level
 * up. An entry that already carries its own magic is left alone.
 *
 * @param {string} path A pathspec as the caller wrote it
 * @return {string} The pathspec to hand to git
 */
export function globPathspec(path) {
  return path.startsWith(':') ? path : `:(glob)${path}`;
}

/**
 * Whether the suite runs, given what the diff held.
 *
 * Only an affirmative "nothing under `paths` changed" skips the run. With no
 * filter, no base to compare against, or a diff that could not be read
 * (`changed` is null), the suite runs: a filter that fails open costs a few
 * minutes, and one that fails closed lets a red suite through unchecked.
 *
 * @param {{ run: boolean, paths: string[] }} config Resolved configuration
 * @param {string[]|null} changed Changed paths under the filter, or null when they could not be determined
 * @return {boolean} True when the suite should run
 */
export function shouldRun(config, changed) {
  if (!config.run || config.paths.length === 0 || changed === null) {
    return true;
  }
  return changed.length > 0;
}

/**
 * The arguments the runner is called with.
 *
 * `separator` inserts the `--` that a wrapper needs in order to pass the rest
 * through to Jest — `sfdx-lwc-jest` is one such wrapper, and Jest called
 * directly is not. Getting it wrong is loud rather than silent: the wrapper
 * rejects the unknown flag, or Jest treats `--` as a test path filter that
 * matches nothing.
 *
 * @param {{ args: string[], separator: boolean, coverage: boolean, resultsFile: string }} config Resolved configuration
 * @return {string[]} Arguments after the command itself
 */
export function testArgs(config) {
  const reporting = ['--json', `--outputFile=${config.resultsFile}`];
  if (config.coverage) {
    reporting.unshift('--coverage');
  }
  return [...config.args, ...(config.separator ? ['--'] : []), ...reporting];
}
