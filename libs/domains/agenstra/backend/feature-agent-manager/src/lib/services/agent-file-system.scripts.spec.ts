import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AGENT_PATH_CONTAINMENT_SCRIPT,
  AGENT_PATH_INSIDE_MARKER,
  AGENT_PATH_OUTSIDE_MARKER,
  AGENT_SYSTEM_FS_SCRIPT,
} from './agent-file-system.scripts';

/**
 * Executes the container scripts in a real POSIX shell against temp-dir fixtures (symlinks, races aside),
 * so the containment logic is verified beyond mocked docker calls.
 */
describe('agent-file-system scripts (real shell)', () => {
  let base: string;
  let workspace: string;
  let outside: string;

  function run(script: string, args: string[], input?: string): { status: number | null; stdout: string } {
    const result = spawnSync('sh', ['-c', script, 'sh', ...args], { input, encoding: 'utf8' });

    return { status: result.status, stdout: result.stdout };
  }

  function containment(target: string, mode: 'follow' | 'nofollow' | 'exact', boundary = workspace): string {
    const parent = target.slice(0, target.lastIndexOf('/')) || '/';
    const name = target.slice(target.lastIndexOf('/') + 1);

    return run(AGENT_PATH_CONTAINMENT_SCRIPT, [boundary, target, mode, parent, name]).stdout.trim();
  }

  function systemOp(op: string, target: string, input?: string): { status: number | null; stdout: string } {
    return run(AGENT_SYSTEM_FS_SCRIPT, [op, target], input);
  }

  function mode(path: string): string {
    return (fs.statSync(path).mode & 0o777).toString(8);
  }

  beforeEach(() => {
    // realpath keeps the fixture paths canonical (tmpdir itself may be a symlink on some hosts).
    base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'agent-fs-scripts-')));
    workspace = join(base, 'app');
    outside = join(base, 'outside');
    fs.mkdirSync(join(workspace, 'src'), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(join(outside, 'secret.txt'), 'secret');
    fs.writeFileSync(join(workspace, 'src', 'a.ts'), 'a');
    fs.symlinkSync(outside, join(workspace, 'escape'));
    fs.symlinkSync(join(outside, 'secret.txt'), join(workspace, 'secret-link'));
    fs.mkdirSync(`${workspace}-sibling`);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  describe('AGENT_PATH_CONTAINMENT_SCRIPT', () => {
    it('accepts regular and not-yet-existing workspace paths', () => {
      expect(containment(join(workspace, 'src', 'a.ts'), 'follow')).toBe(AGENT_PATH_INSIDE_MARKER);
      expect(containment(join(workspace, 'new', 'deep', 'file.txt'), 'follow')).toBe(AGENT_PATH_INSIDE_MARKER);
      expect(containment(workspace, 'follow')).toBe(AGENT_PATH_INSIDE_MARKER);
    });

    it('rejects parent symlinks that leave the workspace in every mode', () => {
      expect(containment(join(workspace, 'escape', 'secret.txt'), 'follow')).toBe(AGENT_PATH_OUTSIDE_MARKER);
      expect(containment(join(workspace, 'escape', 'secret.txt'), 'nofollow')).toBe(AGENT_PATH_OUTSIDE_MARKER);
      expect(containment(join(workspace, 'escape', 'new.txt'), 'follow')).toBe(AGENT_PATH_OUTSIDE_MARKER);
    });

    it('resolves a final symlink in follow mode but keeps it in nofollow mode', () => {
      expect(containment(join(workspace, 'secret-link'), 'follow')).toBe(AGENT_PATH_OUTSIDE_MARKER);
      expect(containment(join(workspace, 'escape'), 'follow')).toBe(AGENT_PATH_OUTSIDE_MARKER);
      expect(containment(join(workspace, 'secret-link'), 'nofollow')).toBe(AGENT_PATH_INSIDE_MARKER);
      expect(containment(join(workspace, 'escape'), 'nofollow')).toBe(AGENT_PATH_INSIDE_MARKER);
    });

    it('does not treat sibling directories sharing the root prefix as inside', () => {
      expect(containment(join(`${workspace}-sibling`, 'x'), 'follow')).toBe(AGENT_PATH_OUTSIDE_MARKER);
    });

    it('requires symlink-free paths in exact mode', () => {
      expect(containment(join(workspace, 'src', 'a.ts'), 'exact', '/')).toBe(AGENT_PATH_INSIDE_MARKER);
      expect(containment(join(workspace, 'escape', 'secret.txt'), 'exact', '/')).toBe(AGENT_PATH_OUTSIDE_MARKER);
      expect(containment(join(workspace, 'secret-link'), 'exact', '/')).toBe(AGENT_PATH_OUTSIDE_MARKER);
    });

    it('treats quotes and command substitutions in names as plain data', () => {
      const marker = join(base, 'PWNED');
      const target = join(workspace, `x'$(touch ${marker})'.txt`);

      expect(containment(target, 'follow')).toBe(AGENT_PATH_INSIDE_MARKER);
      expect(fs.existsSync(marker)).toBe(false);
    });
  });

  describe('AGENT_SYSTEM_FS_SCRIPT', () => {
    it('writes a file from base64 stdin, creating 755 parents and a 644 file', () => {
      const target = join(base, 'opt', 'skills', 'a.md');
      const result = systemOp('write', target, Buffer.from('# skill').toString('base64'));

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(AGENT_PATH_INSIDE_MARKER);
      expect(fs.readFileSync(target, 'utf8')).toBe('# skill');
      expect(mode(target)).toBe('644');
      expect(mode(join(base, 'opt', 'skills'))).toBe('755');
      expect(fs.readdirSync(join(base, 'opt', 'skills'))).toEqual(['a.md']);
    });

    it('stages writes in a private directory and cleans it up on failure', () => {
      const dir = join(base, 'opt', 'existing-dir');

      fs.mkdirSync(join(dir, 'target'), { recursive: true });

      const result = systemOp('write', join(dir, 'target'), Buffer.from('x').toString('base64'));

      expect(result.status).not.toBe(0);
      expect(fs.readdirSync(dir)).toEqual(['target']);
    });

    it('refuses to write through a symlinked parent and leaves the link target untouched', () => {
      const result = systemOp('write', join(workspace, 'escape', 'pwn.txt'), Buffer.from('x').toString('base64'));

      expect(result.status).toBe(65);
      expect(result.stdout).toContain(AGENT_PATH_OUTSIDE_MARKER);
      expect(fs.existsSync(join(outside, 'pwn.txt'))).toBe(false);
    });

    it('replaces a final-component symlink instead of writing through it', () => {
      const result = systemOp('write', join(workspace, 'secret-link'), Buffer.from('new').toString('base64'));

      expect(result.status).toBe(0);
      expect(fs.lstatSync(join(workspace, 'secret-link')).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(join(workspace, 'secret-link'), 'utf8')).toBe('new');
      expect(fs.readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('secret');
    });

    it('creates and hardens the directory itself without recursing into existing content', () => {
      const dir = join(base, 'opt', 'ctx');

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(join(dir, 'private.txt'), 'p', { mode: 0o600 });

      const result = systemOp('mkdir', dir);

      expect(result.status).toBe(0);
      expect(mode(dir)).toBe('755');
      // A recursive chmod could follow hardlinks planted in agent-owned trees.
      expect(mode(join(dir, 'private.txt'))).toBe('600');
    });

    it('refuses mkdir and touch on symlinks', () => {
      expect(systemOp('mkdir', join(workspace, 'escape')).status).toBe(65);
      expect(systemOp('touch', join(workspace, 'secret-link')).status).toBe(65);
      expect(mode(join(outside, 'secret.txt'))).not.toBe('755');
    });

    it('touch creates an empty 644 file only when missing', () => {
      const target = join(base, 'opt', 'empty.txt');

      expect(systemOp('touch', target).status).toBe(0);
      expect(fs.readFileSync(target, 'utf8')).toBe('');
      expect(mode(target)).toBe('644');
    });

    it('deletes a symlink itself, never its target', () => {
      const result = systemOp('delete', join(workspace, 'escape'));

      expect(result.status).toBe(0);
      expect(fs.existsSync(join(workspace, 'escape'))).toBe(false);
      expect(fs.readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('secret');
    });

    it('refuses to delete through a symlinked parent', () => {
      const result = systemOp('delete', join(workspace, 'escape', 'secret.txt'));

      expect(result.status).toBe(65);
      expect(fs.existsSync(join(outside, 'secret.txt'))).toBe(true);
    });

    it('treats deletes under missing parents as no-ops without creating directories', () => {
      const result = systemOp('delete', join(base, 'missing', 'x.txt'));

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(AGENT_PATH_INSIDE_MARKER);
      expect(fs.existsSync(join(base, 'missing'))).toBe(false);
    });

    it('rejects dot names and unknown operations', () => {
      expect(systemOp('write', `${base}/..`, '').status).toBe(65);
      expect(systemOp('chown', join(base, 'x')).status).toBe(64);
    });

    it('treats quotes and command substitutions in names as plain data', () => {
      const marker = join(base, 'PWNED');
      const target = join(base, 'opt', `x'$(touch ${marker})'.md`);

      expect(systemOp('write', target, Buffer.from('q').toString('base64')).status).toBe(0);
      expect(fs.readFileSync(target, 'utf8')).toBe('q');
      expect(fs.existsSync(marker)).toBe(false);
    });
  });
});
