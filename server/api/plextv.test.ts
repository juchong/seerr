import PlexTvAPI, {
  WATCHLIST_METADATA_CONCURRENCY,
  type PlexWatchlistCache,
} from '@server/api/plextv';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import type {
  AxiosAdapter,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

class TestPlexTvAPI extends PlexTvAPI {
  public installAdapter(adapter: AxiosAdapter): void {
    this.axios.defaults.adapter = adapter;
  }
}

function getAxios(api: PlexTvAPI): AxiosInstance {
  return (api as unknown as { axios: AxiosInstance }).axios;
}

function watchlistCache() {
  return cacheManager.getCache('plexwatchlist').data;
}

function axiosResponse<T>(
  config: InternalAxiosRequestConfig,
  data: T,
  headers: Record<string, string> = {}
): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers,
    config,
    request: {},
  };
}

function watchlistResponse(count: number) {
  return {
    MediaContainer: {
      totalSize: count,
      Metadata: Array.from({ length: count }, (_, index) => ({
        ratingKey: `rk-${index + 1}`,
      })),
    },
  };
}

function metadataResponse(ratingKey: string) {
  const id = ratingKey.replace('rk-', '');

  return {
    MediaContainer: {
      Metadata: [
        {
          ratingKey,
          type: 'movie' as const,
          title: `Movie ${id}`,
          Guid: [{ id: `tmdb://${id}` as const }],
        },
      ],
    },
  };
}

function isMetadataRequest(url: string | undefined): boolean {
  return !!url?.includes('/library/metadata/');
}

function isWatchlistRequest(url: string | undefined): boolean {
  return !!url?.includes('/library/sections/watchlist/all');
}

describe('PlexTvAPI.getWatchlist', () => {
  beforeEach(() => {
    cacheManager.getCache('plexwatchlist').flush();
    cacheManager.getCache('plextv').flush();
  });

  afterEach(() => {
    mock.restoreAll();
    cacheManager.getCache('plexwatchlist').flush();
    cacheManager.getCache('plextv').flush();
  });

  it('does not cache or crash on a 2xx body without MediaContainer', async () => {
    const api = new PlexTvAPI('token-empty');
    mock.method(getAxios(api), 'get', async () => ({
      status: 200,
      headers: { etag: '"poison"' },
      data: { errors: [{ code: 1001, message: 'Unavailable' }] },
    }));

    const result = await api.getWatchlist();

    assert.deepEqual(result, {
      offset: 0,
      size: 20,
      totalSize: 0,
      items: [],
    });
    assert.equal(watchlistCache().get('token-empty'), undefined);
  });

  it('keeps a valid cached watchlist when Discover returns a 2xx without MediaContainer', async () => {
    const api = new PlexTvAPI('token-stale');
    watchlistCache().set<PlexWatchlistCache>('token-stale', {
      etag: '"good"',
      response: {
        MediaContainer: { totalSize: 4, Metadata: [] },
      },
    });
    mock.method(getAxios(api), 'get', async () => ({
      status: 200,
      headers: { etag: '"poison"' },
      data: '<html>error</html>',
    }));

    const result = await api.getWatchlist();

    assert.equal(result.totalSize, 4);
    assert.equal(
      watchlistCache().get<PlexWatchlistCache>('token-stale')?.etag,
      '"good"'
    );
  });

  it('drops a poisoned cache entry and does not send If-None-Match', async () => {
    const api = new PlexTvAPI('token-poisoned');
    watchlistCache().set('token-poisoned', {
      etag: '"bad"',
      response: { errors: ['nope'] },
    });

    let requestConfig: AxiosRequestConfig | undefined;
    mock.method(
      getAxios(api),
      'get',
      async (_url: string, config?: AxiosRequestConfig) => {
        requestConfig = config;
        return {
          status: 200,
          headers: { etag: '"fresh"' },
          data: { MediaContainer: { totalSize: 0 } },
        };
      }
    );

    const result = await api.getWatchlist();

    assert.equal(result.totalSize, 0);
    assert.equal(requestConfig?.headers?.['If-None-Match'], undefined);
    assert.equal(
      watchlistCache().get<PlexWatchlistCache>('token-poisoned')?.etag,
      '"fresh"'
    );
  });

  it('does not cache a 2xx body whose MediaContainer is an array', async () => {
    const api = new PlexTvAPI('token-array');
    mock.method(getAxios(api), 'get', async () => ({
      status: 200,
      headers: { etag: '"array"' },
      data: { MediaContainer: [] },
    }));

    const result = await api.getWatchlist();

    assert.deepEqual(result, {
      offset: 0,
      size: 20,
      totalSize: 0,
      items: [],
    });
    assert.equal(watchlistCache().get('token-array'), undefined);
  });

  it('does not cache a 2xx body whose totalSize is not a number', async () => {
    const api = new PlexTvAPI('token-bad-size');
    mock.method(getAxios(api), 'get', async () => ({
      status: 200,
      headers: { etag: '"bad-size"' },
      data: { MediaContainer: { totalSize: 'invalid' } },
    }));

    const result = await api.getWatchlist();

    assert.deepEqual(result, {
      offset: 0,
      size: 20,
      totalSize: 0,
      items: [],
    });
    assert.equal(watchlistCache().get('token-bad-size'), undefined);
  });

  it('returns an empty watchlist when the watchlist fetch fails', async () => {
    const api = new PlexTvAPI('token-fetch-error');
    mock.method(getAxios(api), 'get', async () => {
      throw new Error('network down');
    });

    const result = await api.getWatchlist();

    assert.deepEqual(result, {
      offset: 0,
      size: 20,
      totalSize: 0,
      items: [],
    });
  });

  it('propagates cache manager failures instead of returning an empty watchlist', async () => {
    const api = new PlexTvAPI('token-cache-error');
    const cacheError = new Error('cache unavailable');
    mock.method(cacheManager, 'getCache', () => {
      throw cacheError;
    });

    await assert.rejects(() => api.getWatchlist(), cacheError);
  });

  it('limits concurrent metadata requests', async () => {
    const itemCount = 12;
    let inFlight = 0;
    let maxInFlight = 0;

    const api = new TestPlexTvAPI('test-token');
    api.installAdapter(async (config) => {
      const url = config.url;

      if (isWatchlistRequest(url)) {
        return axiosResponse(config, watchlistResponse(itemCount), {
          etag: 'test-etag',
        });
      }

      if (isMetadataRequest(url)) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight--;

        const ratingKey = url?.split('/library/metadata/')[1] ?? '';
        return axiosResponse(config, metadataResponse(ratingKey));
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await api.getWatchlist({ size: itemCount });

    assert.strictEqual(result.items.length, itemCount);
    assert.ok(
      maxInFlight <= WATCHLIST_METADATA_CONCURRENCY,
      `expected at most ${WATCHLIST_METADATA_CONCURRENCY} concurrent metadata requests, saw ${maxInFlight}`
    );
  });

  it('returns partial results when individual metadata requests fail', async () => {
    const itemCount = 8;

    const api = new TestPlexTvAPI('test-token');
    api.installAdapter(async (config) => {
      const url = config.url;

      if (isWatchlistRequest(url)) {
        return axiosResponse(config, watchlistResponse(itemCount), {
          etag: 'test-etag',
        });
      }

      if (isMetadataRequest(url)) {
        const ratingKey = url?.split('/library/metadata/')[1] ?? '';

        if (Number(ratingKey.replace('rk-', '')) % 2 === 0) {
          const error = new Error('connect ETIMEDOUT') as Error & {
            code: string;
          };
          error.code = 'ETIMEDOUT';
          throw error;
        }

        return axiosResponse(config, metadataResponse(ratingKey));
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await api.getWatchlist({ size: itemCount });

    assert.strictEqual(result.items.length, 4);
    assert.ok(
      result.items.every((item) => Number(item.tmdbId) % 2 === 1),
      'only odd-numbered watchlist items should be returned'
    );
  });

  it('fails the sync when metadata requests return auth errors', async () => {
    const itemCount = 3;

    const api = new TestPlexTvAPI('test-token');
    api.installAdapter(async (config) => {
      const url = config.url;

      if (isWatchlistRequest(url)) {
        return axiosResponse(config, watchlistResponse(itemCount), {
          etag: 'test-etag',
        });
      }

      if (isMetadataRequest(url)) {
        const error = new Error(
          'Request failed with status code 401'
        ) as Error & {
          response: { status: number };
        };
        error.response = { status: 401 };
        throw error;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await api.getWatchlist({ size: itemCount });

    assert.deepStrictEqual(result, {
      offset: 0,
      size: itemCount,
      totalSize: 0,
      items: [],
    });
  });

  it('skips items whose metadata request returns 404', async () => {
    const api = new PlexTvAPI('token-404');
    mock.method(getAxios(api), 'get', async (url: string) => {
      if (url === '/library/sections/watchlist/all') {
        return {
          status: 200,
          headers: { etag: '"fresh"' },
          data: {
            MediaContainer: { totalSize: 1, Metadata: [{ ratingKey: 'abc' }] },
          },
        };
      }

      if (url === '/library/metadata/abc') {
        throw Object.assign(new Error('not found'), {
          response: { status: 404 },
        });
      }

      throw new Error(`unexpected url: ${url}`);
    });

    const result = await api.getWatchlist();

    assert.deepEqual(result, {
      offset: 0,
      size: 20,
      totalSize: 1,
      items: [],
    });
  });

  it('skips items whose metadata response contains no metadata', async () => {
    const api = new PlexTvAPI('token-no-meta');
    mock.method(getAxios(api), 'get', async (url: string) => {
      if (url === '/library/sections/watchlist/all') {
        return {
          status: 200,
          headers: { etag: '"fresh"' },
          data: {
            MediaContainer: {
              totalSize: 2,
              Metadata: [{ ratingKey: 'empty' }, { ratingKey: 'good' }],
            },
          },
        };
      }

      if (url === '/library/metadata/empty') {
        return { status: 200, data: { MediaContainer: {} } };
      }

      if (url === '/library/metadata/good') {
        return {
          status: 200,
          data: {
            MediaContainer: {
              Metadata: [
                {
                  ratingKey: 'good',
                  type: 'movie',
                  title: 'Good Movie',
                  Guid: [{ id: 'tmdb://550' }],
                },
              ],
            },
          },
        };
      }

      throw new Error(`unexpected url: ${url}`);
    });

    const result = await api.getWatchlist();

    assert.deepEqual(result, {
      offset: 0,
      size: 20,
      totalSize: 2,
      items: [
        {
          ratingKey: 'good',
          tmdbId: 550,
          tvdbId: undefined,
          title: 'Good Movie',
          type: 'movie',
        },
      ],
    });
  });
});

describe('PlexTvAPI.getUsersWithServerAccess', () => {
  const tokenOf = (api: PlexTvAPI) =>
    (api as unknown as { authToken: string }).authToken;
  const shared = (id: string, machineIds: string[]) => ({
    $: {
      id,
      title: `user${id}`,
      username: `user${id}`,
      email: `user${id}@seerr.dev`,
      thumb: '',
    },
    Server: machineIds.map((machineIdentifier) => ({
      $: { machineIdentifier },
    })),
  });
  const owner = (id: number) => ({
    id,
    title: `owner${id}`,
    username: `owner${id}`,
    email: `owner${id}@seerr.dev`,
    thumb: '',
  });

  let usersByToken: Record<string, ReturnType<typeof shared>[] | Error>;

  beforeEach(() => {
    const settings = getSettings();
    settings.plex = {
      ...settings.plex,
      name: 'Server A',
      machineId: 'machine-a',
    };
    settings.plexServers = [
      {
        id: 2,
        name: 'Server B',
        machineId: 'machine-b',
        ip: 'plex-b',
        port: 32400,
        libraries: [],
        ownerToken: 'owner-b',
      },
    ];
    mock.method(
      PlexTvAPI.prototype,
      'getUsers',
      async function (this: PlexTvAPI) {
        const users = usersByToken[tokenOf(this)];
        if (users instanceof Error) {
          throw users;
        }
        return { MediaContainer: { User: users ?? [] } };
      }
    );
    mock.method(
      PlexTvAPI.prototype,
      'getUser',
      async function (this: PlexTvAPI) {
        return tokenOf(this) === 'owner-b' ? owner(30) : owner(1);
      }
    );
  });

  afterEach(() => {
    mock.restoreAll();
    getSettings().plexServers = [];
  });

  it("lists users shared on any configured server, read with that server's token", async () => {
    usersByToken = {
      admin: [
        shared('10', ['machine-a']),
        shared('11', ['machine-c']),
        shared('12', ['machine-a', 'machine-b']),
      ],
      'owner-b': [
        shared('20', ['machine-b']),
        shared('12', ['machine-b']),
        // On server B's owner's list, but shared on another server.
        shared('21', ['machine-a']),
      ],
    };

    const users = await PlexTvAPI.getUsersWithServerAccess('admin');

    // 30 is server B's owner.
    assert.deepEqual(users.map((user) => user.id).sort(), [
      '10',
      '12',
      '20',
      '30',
    ]);
    assert.deepEqual(users.find((user) => user.id === '12')?.serverNames, [
      'Server A',
      'Server B',
    ]);
    assert.deepEqual(users.find((user) => user.id === '30')?.serverNames, [
      'Server B',
    ]);
  });

  it('skips a server whose users cannot be read', async () => {
    usersByToken = {
      admin: new Error('plex.tv unavailable'),
      'owner-b': [shared('20', ['machine-b'])],
    };

    const users = await PlexTvAPI.getUsersWithServerAccess('admin');

    assert.deepEqual(users.map((user) => user.id).sort(), ['20', '30']);
  });
});
