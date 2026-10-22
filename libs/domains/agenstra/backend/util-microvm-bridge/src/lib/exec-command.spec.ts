import { MICROVM_EXEC_CLIENT_PATH, MICROVM_VMM_USER } from './constants';
import { ExecClientUsageError, parseExecClientArguments, toMicrovmExecOptions } from './exec-command';

describe('microVM exec rewriting', () => {
  it('runs the original command through the bridge client as the VMM user', () => {
    const rewritten = toMicrovmExecOptions({
      Cmd: ['sh', '-c', 'cat "$1"', 'sh', '/app/file'],
      Env: ['API_KEY=secret', 'MODE=a=b'],
      User: 'agenstra',
      WorkingDir: '/app',
      Tty: false,
      AttachStdin: true,
    });

    expect(rewritten).toEqual({
      Cmd: [
        MICROVM_EXEC_CLIENT_PATH,
        '--user',
        'agenstra',
        '--workdir',
        '/app',
        '--pass-env',
        'API_KEY',
        '--pass-env',
        'MODE',
        '--',
        'sh',
        '-c',
        'cat "$1"',
        'sh',
        '/app/file',
      ],
      Env: ['API_KEY=secret', 'MODE=a=b'],
      User: MICROVM_VMM_USER,
      Tty: false,
      AttachStdin: true,
    });
    // Values never travel as arguments (process list), only names.
    expect(rewritten.Cmd?.join(' ')).not.toContain('secret');
  });

  it('keeps root execs without user arguments', () => {
    expect(toMicrovmExecOptions({ Cmd: ['id'] }).Cmd).toEqual([MICROVM_EXEC_CLIENT_PATH, '--', 'id']);
  });

  it('rejects empty commands, invalid users and malformed env entries', () => {
    expect(() => toMicrovmExecOptions({ Cmd: [] })).toThrow(ExecClientUsageError);
    expect(() => toMicrovmExecOptions({ Cmd: ['id'], User: 'a b' })).toThrow(/unsupported exec user/);
    expect(() => toMicrovmExecOptions({ Cmd: ['id'], Env: ['=x'] })).toThrow(/KEY=VALUE/);
  });

  it('parses what it produces', () => {
    const { Cmd } = toMicrovmExecOptions({ Cmd: ['ls', '--', '-la'], User: '10001:10001', Env: ['A=1'] });

    expect(parseExecClientArguments((Cmd ?? []).slice(1))).toEqual({
      user: '10001:10001',
      workdir: '',
      passEnv: ['A'],
      argv: ['ls', '--', '-la'],
    });
  });

  it.each([
    [['--', ''], /missing command/],
    [['ls'], /unknown option/],
    [['--user'], /needs a value/],
    [['--workdir', 'rel', '--', 'ls'], /absolute/],
    [['--pass-env', 'A B', '--', 'ls'], /pass-env/],
  ])('rejects client arguments %j', (args, message) => {
    expect(() => parseExecClientArguments(args)).toThrow(message);
  });
});
