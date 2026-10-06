import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import type { PlexServerUser } from '@server/api/plextv';
import PlexTvAPI from '@server/api/plextv';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import {
  getPlexServerMembership,
  plexServersOf,
  resetPlexServerMembership,
} from '@server/lib/plexServerMembership';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';

setupTestDb();

const shared = (id: string, serverIds: number[]): PlexServerUser => ({
  id,
  title: `user${id}`,
  username: `user${id}`,
  email: `user${id}@seerr.dev`,
  thumb: '',
  serverIds,
  serverNames: serverIds.map((s) => `Server ${s}`),
});

describe('getPlexServerMembership', () => {
  let lookups: number;

  beforeEach(() => {
    resetPlexServerMembership();
    lookups = 0;
    const settings = getSettings();
    settings.plex = { ...settings.plex, name: 'Server A' };
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
    mock.method(PlexTvAPI, 'getUsersWithServerAccess', async () => {
      lookups++;
      return [shared('500', [2]), shared('600', [1, 2])];
    });
  });

  afterEach(() => {
    mock.restoreAll();
    getSettings().plexServers = [];
    resetPlexServerMembership();
  });

  it('looks nothing up with a single Plex server', async () => {
    getSettings().plexServers = [];

    assert.strictEqual(await getPlexServerMembership(), undefined);
    assert.strictEqual(plexServersOf(undefined, 500), undefined);
    assert.strictEqual(lookups, 0);
  });

  it("lists each user's servers, the admin on the primary one", async () => {
    const admin = await getRepository(User).findOneOrFail({
      where: { id: 1 },
    });

    const membership = await getPlexServerMembership();

    assert.deepEqual(plexServersOf(membership, 500), [
      { id: 2, name: 'Server B' },
    ]);
    assert.deepEqual(plexServersOf(membership, 600), [
      { id: 1, name: 'Server A' },
      { id: 2, name: 'Server B' },
    ]);
    assert.deepEqual(plexServersOf(membership, admin.plexId), [
      { id: 1, name: 'Server A' },
    ]);
    assert.deepEqual(plexServersOf(membership, 999), []);
    assert.deepEqual(plexServersOf(membership, null), []);
  });

  it('reuses one lookup within ten minutes', async () => {
    await getPlexServerMembership();
    await getPlexServerMembership();

    assert.strictEqual(lookups, 1);
  });
});
