import {afterEach, describe, it}                                          from 'node:test';
import assert                                                             from 'node:assert/strict';
import {globPathspec, resolveBaseRef, resolveConfig, shouldRun, testArgs} from '../lib/config.mjs';

/**
 * The inputs, and the one piece of argument assembly that is easy to get wrong.
 */

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) {
      delete process.env[key];
    }
  }
});

describe('resolveConfig', () => {
  it('defaults to the Salesforce LWC runner, installing first', () => {
    const config = resolveConfig();
    assert.equal(config.testCommand, 'npx sfdx-lwc-jest');
    assert.equal(config.separator, true);
    assert.equal(config.install, true);
    assert.equal(config.installCommand, 'npm ci');
    assert.equal(config.resultsFile, 'jest-results.json');
    assert.equal(config.failOnError, true);
    assert.equal(config.section, 'jest');
    assert.deepEqual(config.paths, []);
  });

  it('reads the paths filter as a comma- or newline-separated list', () => {
    process.env.INPUT_PATHS = 'force-app/**/lwc/**\npackage.json, jest.config.js';
    assert.deepEqual(resolveConfig().paths, ['force-app/**/lwc/**', 'package.json', 'jest.config.js']);
  });

  it('resolves the results path against the working directory', () => {
    // The runner writes the file relative to where it ran; this process reads
    // it relative to the action's own directory, which is somewhere else.
    process.env.INPUT_WORKING_DIRECTORY = 'packages/ui';
    assert.equal(resolveConfig().resultsPath, 'packages/ui/jest-results.json');
  });

  it('leaves an absolute results path alone', () => {
    process.env.INPUT_WORKING_DIRECTORY = 'packages/ui';
    process.env.INPUT_RESULTS_FILE = '/tmp/results.json';
    assert.equal(resolveConfig().resultsPath, '/tmp/results.json');
  });

  it('reads the reporting-only shape, where somebody else ran the suite', () => {
    process.env.INPUT_RUN = 'false';
    process.env.INPUT_TEST_OUTCOME = 'failure';
    const config = resolveConfig();
    assert.equal(config.run, false);
    assert.equal(config.testOutcome, 'failure');
  });
});

describe('testArgs', () => {
  const base = {args: [], separator: true, coverage: false, resultsFile: 'jest-results.json'};

  it('puts -- before the reporting flags for a wrapper that passes them through', () => {
    assert.deepEqual(testArgs(base), ['--', '--json', '--outputFile=jest-results.json']);
  });

  it('leaves it out for a runner called directly', () => {
    // Jest reads a bare `--` as a test path filter that matches nothing.
    assert.deepEqual(testArgs({...base, separator: false}), ['--json', '--outputFile=jest-results.json']);
  });

  it('keeps the caller\'s own arguments before the separator, where the wrapper reads them', () => {
    assert.deepEqual(
      testArgs({...base, args: ['--skipApiVersionCheck']}),
      ['--skipApiVersionCheck', '--', '--json', '--outputFile=jest-results.json']
    );
  });

  it('asks for coverage inside the pass-through, since it is the runner that collects it', () => {
    assert.deepEqual(
      testArgs({...base, coverage: true}),
      ['--', '--coverage', '--json', '--outputFile=jest-results.json']
    );
  });

  it('names the results file the caller chose', () => {
    assert.match(testArgs({...base, resultsFile: 'out/j.json'}).at(-1), /--outputFile=out\/j\.json$/);
  });
});

describe('resolveBaseRef', () => {
  afterEach(() => {
    delete process.env.GITHUB_BASE_REF;
  });

  it('takes the pull request\'s base branch from the event', () => {
    process.env.GITHUB_BASE_REF = 'main';
    assert.equal(resolveBaseRef(), 'origin/main');
  });

  it('prefers the caller\'s own ref', () => {
    process.env.GITHUB_BASE_REF = 'main';
    process.env.INPUT_BASE_REF = 'origin/release';
    assert.equal(resolveBaseRef(), 'origin/release');
  });

  it('is empty on an event with no base branch, such as a push', () => {
    assert.equal(resolveBaseRef(), '');
  });
});

describe('shouldRun', () => {
  const filtered = {run: true, paths: ['force-app/**/lwc/**']};

  it('skips when nothing under the paths changed', () => {
    assert.equal(shouldRun(filtered, []), false);
  });

  it('runs when something under the paths changed', () => {
    assert.equal(shouldRun(filtered, ['force-app/main/default/lwc/a/a.js']), true);
  });

  it('runs with no filter, however little changed', () => {
    assert.equal(shouldRun({run: true, paths: []}, []), true);
  });

  it('runs when the diff could not be read, rather than let a red suite through unchecked', () => {
    assert.equal(shouldRun(filtered, null), true);
  });

  it('never skips a report-only run, which has no suite to skip', () => {
    assert.equal(shouldRun({run: false, paths: filtered.paths}, []), true);
  });
});

describe('globPathspec', () => {
  it('asks git for glob matching, so ** can cross zero directories', () => {
    assert.equal(globPathspec('force-app/**/lwc/**'), ':(glob)force-app/**/lwc/**');
  });

  it('leaves an entry that carries its own magic alone', () => {
    assert.equal(globPathspec(':(exclude)force-app/**/legacy/**'), ':(exclude)force-app/**/legacy/**');
  });
});
