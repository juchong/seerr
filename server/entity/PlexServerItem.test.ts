import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { MediaStatus, MediaType } from '@server/constants/media';
import dataSource, { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import PlexServerItem from '@server/entity/PlexServerItem';
import { PRIMARY_PLEX_SERVER_ID } from '@server/lib/settings';

// These tests run the real SQLite migrations instead of synchronizing the
// schema, so they also check that the entity matches the migration.
describe('PlexServerItem', () => {
  before(async () => {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    // Step back to the schema before plex_server_item existed.
    await dataSource.undoLastMigration();

    await dataSource.query(
      `INSERT INTO "media" ("mediaType", "tmdbId", "ratingKey", "ratingKey4k") VALUES
        ('movie', 1, '100', NULL),
        ('movie', 2, NULL, '200'),
        ('tv', 3, '300', '301'),
        ('movie', 4, NULL, NULL)`
    );
    await dataSource.runMigrations();
  });

  it('copies existing rating keys to the primary server', async () => {
    const rows = await dataSource.query(
      `SELECT m."tmdbId", p."serverId", p."ratingKey", p."ratingKey4k"
        FROM "plex_server_item" p JOIN "media" m ON m."id" = p."mediaId"
        ORDER BY m."tmdbId"`
    );

    assert.deepEqual(rows, [
      { tmdbId: 1, serverId: 1, ratingKey: '100', ratingKey4k: null },
      { tmdbId: 2, serverId: 1, ratingKey: null, ratingKey4k: '200' },
      { tmdbId: 3, serverId: 1, ratingKey: '300', ratingKey4k: '301' },
    ]);
  });

  it('loads a title with its rows for each server', async () => {
    const saved = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 10,
        status: MediaStatus.AVAILABLE,
        ratingKey: '1000',
        plexServerItems: [
          new PlexServerItem({
            serverId: PRIMARY_PLEX_SERVER_ID,
            ratingKey: '1000',
          }),
          new PlexServerItem({ serverId: 2, ratingKey: '55' }),
        ],
      })
    );

    const media = await getRepository(Media).findOneOrFail({
      where: { id: saved.id },
    });

    assert.deepEqual(
      media.plexServerItems
        .map((item) => [item.serverId, item.ratingKey])
        .sort(),
      [
        [1, '1000'],
        [2, '55'],
      ]
    );
  });

  it('allows one row per title and server', async () => {
    const media = await getRepository(Media).findOneOrFail({
      where: { tmdbId: 10 },
    });

    await assert.rejects(
      getRepository(PlexServerItem).insert({
        media,
        serverId: 2,
        ratingKey: '56',
      })
    );
  });

  it("clears every server's keys with the title's service data", () => {
    const media = new Media({
      ratingKey: 'a',
      ratingKey4k: 'a4k',
      plexServerItems: [
        new PlexServerItem({ serverId: 1, ratingKey: 'a', ratingKey4k: 'a4k' }),
        new PlexServerItem({ serverId: 2, ratingKey: 'b', ratingKey4k: 'b4k' }),
      ],
    });
    const keys = () =>
      media.plexServerItems.map((item) => [item.ratingKey, item.ratingKey4k]);

    media.resetServiceData(false);
    assert.deepEqual(keys(), [
      [null, 'a4k'],
      [null, 'b4k'],
    ]);

    media.resetServiceData(true);
    assert.deepEqual(keys(), [
      [null, null],
      [null, null],
    ]);
  });

  it("deletes a title's rows with the title", async () => {
    const media = await getRepository(Media).findOneOrFail({
      where: { tmdbId: 10 },
    });

    await getRepository(Media).remove(media);

    assert.equal(
      await getRepository(PlexServerItem).count({
        where: { serverId: 2 },
      }),
      0
    );
  });
});
