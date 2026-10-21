import { BadRequestException, NotFoundException } from '@nestjs/common';

import { parseAgentHandoffCreate, parseAgentHandoffId, parseAgentHandoffRespond } from './agent-handoff.dto';

describe('agent handoff dto', () => {
  const target = '22222222-2222-4222-8222-222222222222';

  it('normalizes create input and drops unknown fields', () => {
    expect(
      parseAgentHandoffCreate({
        targetAgentId: ` ${target.toUpperCase()} `,
        title: ' Review ',
        message: ' Check the API ',
        sourceAgentId: 'spoofed',
      }),
    ).toEqual({ targetAgentId: target, title: 'Review', message: 'Check the API' });
    expect(
      parseAgentHandoffCreate({ targetAgentId: target, title: 't', message: 'm', model: 'openai/gpt-5' }).model,
    ).toBe('openai/gpt-5');
  });

  it('rejects incomplete or oversized create input', () => {
    expect(() => parseAgentHandoffCreate({ targetAgentId: target, title: 't' })).toThrow(BadRequestException);
    expect(() => parseAgentHandoffCreate({ targetAgentId: target, title: 'x'.repeat(201), message: 'm' })).toThrow(
      BadRequestException,
    );
    expect(() => parseAgentHandoffCreate({ targetAgentId: target, title: 't', message: 'm', model: 1 })).toThrow(
      BadRequestException,
    );
    expect(() => parseAgentHandoffCreate({ targetAgentId: 'not-a-uuid', title: 't', message: 'm' })).toThrow(
      NotFoundException,
    );
    expect(() => parseAgentHandoffCreate(null)).toThrow(BadRequestException);
  });

  it('validates responses', () => {
    expect(parseAgentHandoffRespond({ status: 'failed', response: ' Not possible ' })).toEqual({
      status: 'failed',
      response: 'Not possible',
    });
    expect(() => parseAgentHandoffRespond({ status: 'done', response: 'x' })).toThrow(BadRequestException);
    expect(() => parseAgentHandoffRespond({ status: 'completed', response: '  ' })).toThrow(BadRequestException);
  });

  it('treats malformed ids as unknown handoffs', () => {
    expect(parseAgentHandoffId(target.toUpperCase())).toBe(target);
    expect(() => parseAgentHandoffId('../x')).toThrow(NotFoundException);
    expect(() => parseAgentHandoffId(undefined)).toThrow(NotFoundException);
  });
});
