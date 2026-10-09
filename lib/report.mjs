import {failedAssertions, renderCounts, summarize} from './results.mjs';

/**
 * What a reader is told: a headline in the pull request comment, the detail in
 * the job summary.
 *
 * The split is deliberate. Failure messages are long and were written for a
 * terminal; a comment full of them is a comment nobody reads, and a comment
 * with no failures named is one nobody can act on. So the comment lists the
 * failed tests by name, capped, and the summary carries their messages.
 */

/**
 * The comment section: one line when green, a bounded failure list when not.
 *
 * @param {object} results Aggregated results
 * @param {{ label: string, maxListed: number, cwd?: string }} options How the check is named and how much it lists
 * @return {string} Markdown for the comment section
 */
export function renderComment(results, options) {
  const {label, maxListed, cwd} = options;
  const counts = renderCounts(results);

  if (summarize(results).ok) {
    return `:white_check_mark: **${label} passed**: ${counts}`;
  }

  const failures = failedAssertions(results, cwd);
  const listed = failures.slice(0, maxListed);
  const lines = [`:x: **${label} failed**: ${counts}`, ''];
  for (const failure of listed) {
    lines.push(`- \`${failure.suite}\` — ${failure.name}`);
  }
  if (failures.length > listed.length) {
    lines.push(`- …and ${failures.length - listed.length} more`);
  }
  lines.push('', `Failure detail is in the "${label}" job log and its step summary.`);
  return lines.join('\n');
}

/**
 * The job summary: the same headline plus each failure's message, which is too
 * long and was too ANSI-coloured for the comment.
 *
 * @param {object} results Aggregated results
 * @param {{ label: string, cwd?: string }} options How the check is named
 * @return {string} Markdown for the step summary
 */
export function renderSummary(results, options) {
  const {label, cwd} = options;
  const heading = summarize(results).ok
    ? `## :white_check_mark: ${label} passed (${renderCounts(results)})`
    : `## :x: ${label} failed (${renderCounts(results)})`;
  const lines = [heading];

  for (const failure of failedAssertions(results, cwd)) {
    lines.push('', `### \`${failure.suite}\` — ${failure.name}`, '', '```', failure.message, '```');
  }
  return lines.join('\n');
}

/**
 * The comment section for a run that produced no results file at all.
 *
 * That is a configuration or module-resolution failure rather than a test
 * failure, so there are no numbers to report and the only useful thing to say
 * is where to look.
 *
 * @param {{ label: string, outcome: string, path: string }} context How the check is named, what the run's own outcome was, and where the file was expected
 * @return {string} Markdown for the comment section
 */
export function renderMissingResults({label, outcome, path}) {
  return [
    `:x: **${label}**: produced no results file` +
    (outcome === 'success' ? '.' : ` (test step outcome: \`${outcome}\`).`),
    '',
    `Nothing was written to \`${path}\`, so the run stopped before it could report — check the "${label}" job log.`
  ].join('\n');
}

/**
 * The comment section for a run that skipped the suite because nothing under
 * the configured paths changed.
 *
 * @param {{ label: string, paths: string[] }} context How the check is named and which paths it watches
 * @return {string} Markdown for the comment section
 */
export function renderSkipped({label, paths}) {
  return `:fast_forward: **${label} skipped**: no changes under ${paths.map((path) => `\`${path}\``).join(', ')}`;
}
