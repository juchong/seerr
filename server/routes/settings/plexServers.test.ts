import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import PlexAPI from '@server/api/plexapi';
import PlexTvAPI from '@server/api/plextv';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import PlexServerItem from '@server/entity/PlexServerItem';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import type { AxiosInstance } from 'axios';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import plexServerRoutes from './plexServers';

let app: Express;

before(() => {
  app = express();
  app.use(express.json());
  app.use('/settings/plex/servers', plexServerRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
});

setupTestDb();

describe('/settings/plex/servers', () => {
  // Plex server behind each address, and the servers each token's account
  // owns according to plex.tv.
  const machineByHost: Record<string, string> = {
    'plex-a': 'machine-a',
    'plex-b': 'machine-b',
  };
  const ownedByToken: Record<string, string[]> = {
    'owner-a': ['machine-a'],
    'owner-b': ['machine-b'],
    'shared-user': [],
  };

  beforeEach(() => {
    const settings = getSettings();
    settings.plex = { ...settings.plex, ip: 'plex-a', machineId: 'machine-a' };
    settings.plexServers = [];

    mock.method(PlexAPI.prototype, 'getStatus', async function (this: PlexAPI) {
      const host = new URL(
        (this as unknown as { axios: AxiosInstance }).axios.defaults.baseURL ??
          ''
      ).hostname;
      return {
        MediaContainer: {
          machineIdentifier: machineByHost[host],
          friendlyName: `Server ${host}`,
        },
      };
    });
    mock.method(PlexAPI.prototype, 'getLibraries', async () => []);
    mock.method(
      PlexTvAPI.prototype,
      'getDevices',
      async function (this: PlexTvAPI) {
        const token = (this as unknown as { authToken: string }).authToken;
        // Every token can see both servers; only the owner's marks it owned.
        return ['machine-a', 'machine-b'].map((clientIdentifier) => ({
          clientIdentifier,
          provides: ['server'],
          owned: ownedByToken[token]?.includes(clientIdentifier) ?? false,
        }));
      }
    );
  });

  afterEach(() => {
    mock.restoreAll();
    getSettings().plexServers = [];
  });

  const addServerB = () =>
    request(app)
      .post('/settings/plex/servers')
      .send({ ip: 'plex-b', port: 32400, ownerToken: 'owner-b' });

  it("adds a server owned by the token's account without returning the token", async () => {
    const res = await addServerB();

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.id, 2);
    assert.strictEqual(res.body.machineId, 'machine-b');
    assert.strictEqual(res.body.name, 'Server plex-b');
    assert.strictEqual(res.body.hasOwnerToken, true);
    assert.ok(!('ownerToken' in res.body));
    assert.strictEqual(getSettings().plexServers[0].ownerToken, 'owner-b');

    const list = await request(app).get('/settings/plex/servers');
    assert.strictEqual(list.status, 200);
    assert.ok(!('ownerToken' in list.body[0]));
  });

  it('refuses a token whose account does not own the server', async () => {
    const res = await request(app)
      .post('/settings/plex/servers')
      .send({ ip: 'plex-b', port: 32400, ownerToken: 'shared-user' });

    assert.strictEqual(res.status, 400);
    assert.deepEqual(getSettings().plexServers, []);
  });

  it('refuses a server that is already configured', async () => {
    const res = await request(app)
      .post('/settings/plex/servers')
      .send({ ip: 'plex-a', port: 32400, ownerToken: 'owner-a' });

    assert.strictEqual(res.status, 409);
    assert.deepEqual(getSettings().plexServers, []);
  });

  it('keeps the stored token when an update omits it', async () => {
    await addServerB();

    const res = await request(app)
      .put('/settings/plex/servers/2')
      .send({ ip: 'plex-b', port: 32401 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.port, 32401);
    assert.strictEqual(getSettings().plexServers[0].ownerToken, 'owner-b');
  });

  it("removes a server and only that server's rating keys", async () => {
    await addServerB();
    await getRepository(Media).save(
      new Media({
        tmdbId: 300,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        ratingKey: 'a-300',
        plexServerItems: [
          new PlexServerItem({ serverId: 1, ratingKey: 'a-300' }),
          new PlexServerItem({ serverId: 2, ratingKey: 'b-300' }),
        ],
      })
    );

    const res = await request(app).delete('/settings/plex/servers/2');

    assert.strictEqual(res.status, 204);
    assert.deepEqual(getSettings().plexServers, []);
    const items = await getRepository(PlexServerItem).find();
    assert.deepEqual(
      items.map((item) => [item.serverId, item.ratingKey]),
      [[1, 'a-300']]
    );
  });
});
