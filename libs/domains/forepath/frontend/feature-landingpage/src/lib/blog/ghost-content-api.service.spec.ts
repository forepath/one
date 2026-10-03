import { PendingTasks } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import GhostContentAPI from '@tryghost/content-api';
import { firstValueFrom } from 'rxjs';

import { GhostContentApiService, buildGhostTitleSearchFilter } from './ghost-content-api.service';

const browseMock = jest.fn();
const readMock = jest.fn();
const GhostContentAPIMock = GhostContentAPI as jest.MockedFunction<typeof GhostContentAPI>;

jest.mock('@tryghost/content-api', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    posts: {
      browse: browseMock,
      read: readMock,
    },
  })),
}));

describe('buildGhostTitleSearchFilter', () => {
  it('returns undefined for blank query', () => {
    expect(buildGhostTitleSearchFilter('   ')).toBeUndefined();
  });

  it('wraps trimmed query in Ghost contains filter', () => {
    expect(buildGhostTitleSearchFilter('  cloud  ')).toBe("title:~'cloud'");
  });

  it('escapes single quotes in the query', () => {
    expect(buildGhostTitleSearchFilter("it's")).toBe("title:~'it\\'s'");
  });
});

describe('GhostContentApiService', () => {
  const removeTask = jest.fn();
  const pendingTasksAdd = jest.fn(() => removeTask);

  function configureService(environment: unknown): GhostContentApiService {
    TestBed.configureTestingModule({
      providers: [
        GhostContentApiService,
        { provide: ENVIRONMENT, useValue: environment },
        { provide: PendingTasks, useValue: { add: pendingTasksAdd } },
      ],
    });
    return TestBed.inject(GhostContentApiService);
  }

  beforeEach(() => {
    browseMock.mockReset();
    readMock.mockReset();
    removeTask.mockReset();
    pendingTasksAdd.mockClear();
    GhostContentAPIMock.mockReset();
    GhostContentAPIMock.mockImplementation(
      () =>
        ({
          posts: {
            browse: browseMock,
            read: readMock,
          },
        }) as ReturnType<typeof GhostContentAPI>,
    );
  });

  it('browsePosts maps SDK browse result and passes search filter', async () => {
    const posts = [{ id: '1', slug: 'hello', title: 'Hello' }];
    const meta = {
      pagination: { page: 1, limit: 12, pages: 1, total: 1, next: null, prev: null },
    };
    Object.assign(posts, { meta });
    browseMock.mockResolvedValue(posts);

    const service = configureService({
      blog: {
        urls: { contentApi: 'https://blog.forepath.io' },
        contentApiKey: 'test-key',
      },
    });
    const result = await firstValueFrom(service.browsePosts({ page: 2, limit: 6, query: 'ai' }));

    expect(browseMock).toHaveBeenCalledWith({
      page: 2,
      limit: 6,
      include: 'tags,authors',
      filter: "title:~'ai'",
    });
    expect(result.posts).toEqual(posts);
    expect(result.meta).toEqual(meta);
  });

  it('getPostBySlug reads by slug', async () => {
    const post = { id: '1', slug: 'welcome', title: 'Welcome' };
    readMock.mockResolvedValue(post);

    const service = configureService({
      blog: {
        urls: { contentApi: 'https://blog.forepath.io/' },
        contentApiKey: 'test-key',
      },
    });
    const result = await firstValueFrom(service.getPostBySlug(' welcome '));

    expect(readMock).toHaveBeenCalledWith({ slug: 'welcome' }, { include: 'tags,authors' });
    expect(result).toEqual(post);
  });

  it('registers and clears PendingTasks around browsePosts', async () => {
    const posts = [{ id: '1', slug: 'hello', title: 'Hello' }];
    Object.assign(posts, {
      meta: { pagination: { page: 1, limit: 12, pages: 1, total: 1, next: null, prev: null } },
    });
    browseMock.mockResolvedValue(posts);

    const service = configureService({
      blog: {
        urls: { contentApi: 'https://blog.forepath.io' },
        contentApiKey: 'test-key',
      },
    });

    await firstValueFrom(service.browsePosts());

    expect(pendingTasksAdd).toHaveBeenCalledTimes(1);
    expect(removeTask).toHaveBeenCalledTimes(1);
  });

  it('registers and clears PendingTasks around getPostBySlug', async () => {
    readMock.mockResolvedValue({ id: '1', slug: 'welcome', title: 'Welcome' });

    const service = configureService({
      blog: {
        urls: { contentApi: 'https://blog.forepath.io' },
        contentApiKey: 'test-key',
      },
    });

    await firstValueFrom(service.getPostBySlug('welcome'));

    expect(pendingTasksAdd).toHaveBeenCalledTimes(1);
    expect(removeTask).toHaveBeenCalledTimes(1);
  });

  it('clears PendingTasks when browsePosts errors', async () => {
    browseMock.mockRejectedValue(new Error('network'));

    const service = configureService({
      blog: {
        urls: { contentApi: 'https://blog.forepath.io' },
        contentApiKey: 'test-key',
      },
    });

    await expect(firstValueFrom(service.browsePosts())).rejects.toThrow('network');
    expect(pendingTasksAdd).toHaveBeenCalledTimes(1);
    expect(removeTask).toHaveBeenCalledTimes(1);
  });

  it('errors when blog config is missing', async () => {
    const service = configureService({});

    await expect(firstValueFrom(service.browsePosts())).rejects.toThrow('Ghost blog is not configured.');
    expect(GhostContentAPIMock).not.toHaveBeenCalled();
    expect(pendingTasksAdd).not.toHaveBeenCalled();
  });

  it('falls back to null api when GhostContentAPI construction throws', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    GhostContentAPIMock.mockImplementation(() => {
      throw new Error('invalid key');
    });

    const service = configureService({
      blog: {
        urls: { contentApi: 'https://blog.forepath.io' },
        contentApiKey: 'bad-key',
      },
    });

    await expect(firstValueFrom(service.browsePosts())).rejects.toThrow('Ghost blog is not configured.');
    await expect(firstValueFrom(service.getPostBySlug('any'))).rejects.toThrow('Ghost blog is not configured.');
    expect(GhostContentAPIMock).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to create Ghost Content API instance:', expect.any(Error));
    expect(pendingTasksAdd).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
