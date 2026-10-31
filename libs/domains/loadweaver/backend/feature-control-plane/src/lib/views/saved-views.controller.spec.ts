import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateViewDto, ListViewsQueryDto, UpdateViewDto } from './saved-views.controller';

async function errors<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const result = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });

  return result.map((e) => e.property);
}

describe('saved views DTOs (3.37)', () => {
  it('accepts list ids / settings as scope and trims the name', async () => {
    expect(await errors(CreateViewDto, { scope: 'contents', name: 'Mine', state: {} })).toEqual([]);
    expect(await errors(CreateViewDto, { scope: 'tree:projects', name: 'x', state: { a: [1] } })).toEqual([]);
    expect(plainToInstance(CreateViewDto, { scope: 's', name: '  Mine  ', state: {} }).name).toBe('Mine');
    expect(await errors(ListViewsQueryDto, {})).toEqual([]);
    expect(await errors(ListViewsQueryDto, { scope: 'audit' })).toEqual([]);
  });

  it('refuses invalid scopes, names, states and unknown fields', async () => {
    for (const scope of ['', 'Contents', '-x', 'a/b', 'x'.repeat(101)])
      expect(await errors(CreateViewDto, { scope, name: 'n', state: {} })).toContain('scope');

    for (const name of ['', '   ', 'x'.repeat(101), 3])
      expect(await errors(CreateViewDto, { scope: 's', name, state: {} })).toContain('name');

    for (const state of [[], 'x', null, undefined])
      expect(await errors(CreateViewDto, { scope: 's', name: 'n', state })).toContain('state');

    expect(await errors(CreateViewDto, { scope: 's', name: 'n', state: {}, owner: 'bob' })).toContain('owner');
    expect(await errors(UpdateViewDto, {})).toEqual([]);
    expect(await errors(UpdateViewDto, { name: ' ' })).toContain('name');
    expect(await errors(UpdateViewDto, { state: [] })).toContain('state');
    expect(await errors(ListViewsQueryDto, { scope: 'A' })).toContain('scope');
  });
});
