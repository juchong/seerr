import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { MediaStatus, MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import PlexServerItem from '@server/entity/PlexServerItem';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';

setupTestDb();

describe('Media Plex links with several Plex servers', () => {
  beforeEach(() => {
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.PLEX;
    settings.plex = { ...settings.plex, machineId: 'machine-a' };
    settings.plexServers = [
      {
        id: 2,
        name: 'Server B',
        machineId: 'machine-b',
        ip: 'plex-b',
        port: 32400,
        libraries: [],
      },
    ];
  });

  afterEach(() => {
    getSettings().plexServers = [];
  });

  const linkTo = (machineId: string, ratingKey: string) =>
    `https://app.plex.tv/desktop#!/server/${machineId}/details?key=%2Flibrary%2Fmetadata%2F${ratingKey}`;

  it('links every other server that has the title', () => {
    const media = new Media({
      ratingKey: 'a1',
      plexServerItems: [
        new PlexServerItem({ serverId: 1, ratingKey: 'a1' }),
        new PlexServerItem({ serverId: 2, ratingKey: 'b1' }),
      ],
    });

    media.setPlexUrls();

    assert.strictEqual(media.mediaUrl, linkTo('machine-a', 'a1'));
    assert.deepEqual(media.additionalPlexUrls, [
      { serverName: 'Server B', mediaUrl: linkTo('machine-b', 'b1') },
    ]);
  });

  it('takes the main link from another server when the primary lacks the title', () => {
    const media = new Media({
      plexServerItems: [new PlexServerItem({ serverId: 2, ratingKey: 'b2' })],
    });

    media.setPlexUrls();

    assert.strictEqual(media.mediaUrl, linkTo('machine-b', 'b2'));
    assert.strictEqual(
      media.iOSPlexUrl,
      'plex://preplay/?metadataKey=%2Flibrary%2Fmetadata%2Fb2&server=machine-b'
    );
    assert.deepEqual(media.additionalPlexUrls, []);
  });

  it('builds the links when a title is loaded', async () => {
    await getRepository(Media).save(
      new Media({
        tmdbId: 400,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        plexServerItems: [new PlexServerItem({ serverId: 2, ratingKey: 'b4' })],
      })
    );

    const media = await getRepository(Media).findOneOrFail({
      where: { tmdbId: 400 },
    });

    assert.strictEqual(media.mediaUrl, linkTo('machine-b', 'b4'));
  });

  it('adds nothing with a single Plex server', () => {
    getSettings().plexServers = [];
    const media = new Media({
      ratingKey: 'a3',
      plexServerItems: [new PlexServerItem({ serverId: 1, ratingKey: 'a3' })],
    });

    media.setPlexUrls();

    assert.strictEqual(media.mediaUrl, linkTo('machine-a', 'a3'));
    assert.strictEqual(media.additionalPlexUrls, undefined);
  });
});
