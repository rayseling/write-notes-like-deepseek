import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'notes-skill-install-')));
const env = { ...process.env, DISABLE_TELEMETRY: '1' };
delete env.AGENT_NOTE_ROOT;
delete env.AGENT_NOTE_ARCHIVE_BASE_REF;

function run(cwd, args, success = true) {
  const result = spawnSync('npx', ['--yes', ...args], { cwd, env, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status === 0, success, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  for (const mode of ['symlink', 'copy']) {
    const host = join(scratch, mode);
    mkdirSync(host);
    // Deliberately omit --skill: discover the single skill from the repository root.
    const output = run(host, ['skills@1.7.1', 'add', repo, '--agent', 'codex', 'claude-code', '-y',
      ...(mode === 'copy' ? ['--copy'] : [])]);
    assert.match(output, /write-notes-like-deepseek/);

    const canonical = join(host, '.agents/skills/write-notes-like-deepseek');
    const claude = join(host, '.claude/skills/write-notes-like-deepseek');
    for (const installed of [canonical, claude]) {
      assert.deepEqual(readdirSync(installed).sort(), ['SKILL.md', 'assets', 'references', 'scripts', 'templates']);
      assert.deepEqual(readdirSync(join(installed, 'assets')), ['agent-notes-board.html']);
      assert.ok(existsSync(join(installed, 'templates/verify-notes.yml')));
      assert.equal(readFileSync(join(installed, 'SKILL.md'), 'utf8'),
        readFileSync(join(repo, 'skills/write-notes-like-deepseek/SKILL.md'), 'utf8'));
    }

    const noteDir = join(host, '.agents/notes/implemented/process');
    mkdirSync(noteDir, { recursive: true });
    const note = join(noteDir, '2026-10-07-install-check.md');
    writeFileSync(note, '# Agent Note: Install check\n\nStatus: implemented\n\n## Problem\nValidate installed paths.\n\n## Decision\nRun from the host project.\n\n## Alternatives considered\nRunning from the skill directory targets the wrong notes.\n\n## Consequences\nHost notes are checked.\n');
    const script = (name) => join(canonical, 'scripts', `${name}.ts`);
    for (const name of ['verify-agent-note-tree', 'verify-agent-note-format', 'verify-archived-agent-notes']) {
      run(host, ['tsx', script(name)]);
    }
    // A broken host note must fail even though the installed skill has no notes.
    writeFileSync(note, readFileSync(note, 'utf8').replace('Status: implemented', 'Status: proposed'));
    run(host, ['tsx', join(claude, 'scripts/verify-agent-note-format.ts')], false);
    writeFileSync(note, readFileSync(note, 'utf8').replace('Status: proposed', 'Status: implemented'));
    run(host, ['tsx', script('build-board'), '--init', 'board.html', 'Install check']);
    assert.match(readFileSync(join(host, 'board.html'), 'utf8'), /Install check/);
    run(host, ['tsx', script('build-board'), '--bundle', '.agents/notes', 'demo.html', 'Install check']);
    assert.match(readFileSync(join(host, 'demo.html'), 'utf8'), /Host notes are checked/);
    run(host, ['tsx', script('archive-agent-note'), note]);
    run(host, ['tsx', script('verify-archived-agent-notes')]);
    assert.ok(existsSync(join(host, '.agents/notes/archived/process/2026-10-07-install-check.md')));

    // The eight dsh-* skills install beside the notes skill, and their gates run from the host root.
    const dshSkills = ['dsh-layer-instructions', 'dsh-gate-every-rule', 'dsh-pre-push-checks', 'dsh-create-upgrade-guide',
      'dsh-error-handling', 'dsh-prose-standard', 'dsh-trim-cot-leakage', 'dsh-agent-experience'];
    for (const name of dshSkills) {
      for (const base of ['.agents/skills', '.claude/skills']) assert.ok(existsSync(join(host, base, name, 'SKILL.md')), `${base}/${name}`);
    }
    const gateDir = join(host, '.agents/skills/dsh-gate-every-rule');
    const instrDir = join(host, '.agents/skills/dsh-layer-instructions');
    writeFileSync(join(host, 'AGENTS.md'), readFileSync(join(instrDir, 'templates/AGENTS.root.md'), 'utf8'));
    writeFileSync(join(host, '.agents/doc-budgets.json'), '{ "AGENTS.md": 2000 }\n');
    writeFileSync(join(host, '.agents/escape-hatches.json'), readFileSync(join(gateDir, 'templates/escape-hatches.json'), 'utf8'));
    writeFileSync(join(host, '.agents/gates.json'), readFileSync(join(gateDir, 'templates/gates.json'), 'utf8'));
    mkdirSync(join(host, 'docs'), { recursive: true });
    writeFileSync(join(host, 'docs/architecture.md'), '# Architecture\n');
    spawnSync('git', ['init', '-q'], { cwd: host });
    run(host, ['tsx', join(gateDir, 'scripts/verify-escape-hatch-baseline.ts'), '--init']);
    run(host, ['tsx', join(gateDir, 'scripts/run-gates.ts')]);
    // A ceiling below the current word count must fail the budget gate through the runner.
    writeFileSync(join(host, '.agents/doc-budgets.json'), '{ "AGENTS.md": 10 }\n');
    run(host, ['tsx', join(gateDir, 'scripts/run-gates.ts'), '--only', 'doc-budgets'], false);
    console.log(`ok: ${mode} installation, Codex/Claude paths, host validation, boards, archive, dsh-* gates`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
