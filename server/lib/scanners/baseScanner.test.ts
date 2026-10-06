import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import BaseScanner from '@server/lib/scanners/baseScanner';
import { setupTestDb } from '@server/test/db';

class TestScanner extends BaseScanner<unknown> {
  constructor() {
    super('Test Scan');
  }

  public movie(...args: Parameters<BaseScanner<unknown>['processMovie']>) {
    return this.processMovie(...args);
  }

  public show(...args: Parameters<BaseScanner<unknown>['processShow']>) {
    return this.processShow(...args);
  }
}

setupTestDb();

const keysByServer = (media: Media) =>
  Object.fromEntries(
    media.plexServerItems.map((item) => [item.serverId, item.ratingKey])
  );

const fullSeason = (seasonNumber: number) => ({
  seasonNumber,
  totalEpisodes: 10,
  episodes: 10,
  episodes4k: 0,
});

describe('BaseScanner Plex rating keys per server', () => {
  it('keeps the primary server key on the media row', async () => {
    const scanner = new TestScanner();

    await scanner.movie(100, { ratingKey: 'a-100', plexServerId: 1 });
    await scanner.movie(100, { ratingKey: 'b-100', plexServerId: 2 });
    // A rescan of the second server must not move the row's key.
    await scanner.movie(100, { ratingKey: 'b-100', plexServerId: 2 });

    const media = await getRepository(Media).findOneOrFail({
      where: { tmdbId: 100, mediaType: MediaType.MOVIE },
    });
    assert.strictEqual(media.ratingKey, 'a-100');
    assert.deepEqual(keysByServer(media), { 1: 'a-100', 2: 'b-100' });
  });

  it('records a movie first seen on an additional server only there', async () => {
    await new TestScanner().movie(101, {
      ratingKey: 'b-101',
      plexServerId: 2,
    });

    const media = await getRepository(Media).findOneOrFail({
      where: { tmdbId: 101, mediaType: MediaType.MOVIE },
    });
    assert.strictEqual(media.status, MediaStatus.AVAILABLE);
    assert.strictEqual(media.ratingKey ?? null, null);
    assert.deepEqual(keysByServer(media), { 2: 'b-101' });
  });

  it('records each server key of a show', async () => {
    const scanner = new TestScanner();

    // New show from the second server, then the primary server's copy.
    await scanner.show(200, 2000, [fullSeason(1)], {
      ratingKey: 'b-200',
      plexServerId: 2,
    });
    let media = await getRepository(Media).findOneOrFail({
      where: { tmdbId: 200, mediaType: MediaType.TV },
    });
    assert.strictEqual(media.ratingKey ?? null, null);
    assert.deepEqual(keysByServer(media), { 2: 'b-200' });

    await scanner.show(200, 2000, [fullSeason(1)], {
      ratingKey: 'a-200',
      plexServerId: 1,
    });
    media = await getRepository(Media).findOneOrFail({
      where: { tmdbId: 200, mediaType: MediaType.TV },
    });
    assert.strictEqual(media.ratingKey, 'a-200');
    assert.deepEqual(keysByServer(media), { 1: 'a-200', 2: 'b-200' });
  });

  it('leaves scans without a Plex server unchanged', async () => {
    await new TestScanner().movie(102, { jellyfinMediaId: 'jf-102' });

    const media = await getRepository(Media).findOneOrFail({
      where: { tmdbId: 102, mediaType: MediaType.MOVIE },
    });
    assert.strictEqual(media.jellyfinMediaId, 'jf-102');
    assert.deepEqual(media.plexServerItems, []);
  });
});
