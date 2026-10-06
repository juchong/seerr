import PlexTvAPI from '@server/api/plextv';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings, PRIMARY_PLEX_SERVER_ID } from '@server/lib/settings';

export interface PlexServerRef {
  id: number;
  name: string;
}

// ponytail: kept in memory for 10 minutes; store it per user instead if
// plex.tv lookups become slow or rate-limited.
const CACHE_TTL = 10 * 60 * 1000;
let cache: { expires: number; byPlexId: Map<number, number[]> } | undefined;

/**
 * The configured Plex servers each plex.tv user is on, keyed by Plex ID.
 * Looked up only when additional servers exist, so a single-server
 * install behaves as upstream.
 */
export const getPlexServerMembership = async (): Promise<
  Map<number, number[]> | undefined
> => {
  if (!getSettings().plexServers.length) {
    return undefined;
  }
  if (cache && cache.expires > Date.now()) {
    return cache.byPlexId;
  }

  const admin = await getRepository(User).findOne({
    select: { id: true, plexId: true, plexToken: true },
    where: { id: 1 },
  });
  const byPlexId = new Map<number, number[]>();
  for (const user of await PlexTvAPI.getUsersWithServerAccess(
    admin?.plexToken ?? ''
  )) {
    byPlexId.set(Number(user.id), user.serverIds);
  }
  // The admin owns the primary server, so no shared list includes them there.
  if (admin?.plexId) {
    byPlexId.set(admin.plexId, [
      PRIMARY_PLEX_SERVER_ID,
      ...(byPlexId.get(admin.plexId) ?? []),
    ]);
  }

  cache = { expires: Date.now() + CACHE_TTL, byPlexId };
  return byPlexId;
};

/** For tests: forget the cached membership. */
export const resetPlexServerMembership = (): void => {
  cache = undefined;
};

/** The Plex servers (id and name) a user is on, if servers are known. */
export const plexServersOf = (
  membership: Map<number, number[]> | undefined,
  plexId?: number | null
): PlexServerRef[] | undefined => {
  if (!membership) {
    return undefined;
  }
  const settings = getSettings();
  return (plexId ? (membership.get(plexId) ?? []) : []).map((id) => ({
    id,
    name: settings.getPlexServer(id)?.name ?? `Server ${id}`,
  }));
};
