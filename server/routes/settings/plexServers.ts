import PlexAPI from '@server/api/plexapi';
import PlexTvAPI from '@server/api/plextv';
import { getRepository } from '@server/datasource';
import PlexServerItem from '@server/entity/PlexServerItem';
import type { PlexServerSettings } from '@server/lib/settings';
import { getSettings, PRIMARY_PLEX_SERVER_ID } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';
import { z } from 'zod';

// Additional Plex servers (ids 2 and up); the primary server is managed
// through /settings/plex. Owner tokens are accepted but never returned.
const plexServerRoutes = Router();

const serverBodySchema = z.object({
  ip: z.string().min(1),
  port: z.number().int().positive(),
  useSsl: z.boolean().optional(),
  webAppUrl: z.string().optional(),
  ownerToken: z.string().min(1).optional(),
});

const libraryUpdateSchema = z.object({ enabled: z.boolean() });

class NotOwnerError extends Error {}

type PublicPlexServer = Omit<PlexServerSettings, 'ownerToken'> & {
  hasOwnerToken: boolean;
};

const toPublic = ({
  ownerToken,
  ...server
}: PlexServerSettings): PublicPlexServer => ({
  ...server,
  hasOwnerToken: !!ownerToken,
});

const findServer = (id: string): PlexServerSettings | undefined =>
  getSettings().plexServers.find((server) => server.id === Number(id));

/**
 * Connects to the server with the owner's token and checks on plex.tv that
 * the token's account owns it: a shared user's token also reaches the
 * server, but its shared-user list is not the server's.
 */
const identifyOwnedServer = async (
  address: z.infer<typeof serverBodySchema>,
  ownerToken: string
): Promise<{ machineId: string; name: string }> => {
  const status = await new PlexAPI({
    plexToken: ownerToken,
    plexSettings: { ...address, name: '', libraries: [] },
  }).getStatus();
  const machineId = status?.MediaContainer?.machineIdentifier;
  if (!machineId) {
    throw new Error('Server not found');
  }

  const devices = await new PlexTvAPI(ownerToken).getDevices();
  if (
    !devices.some(
      (device) => device.clientIdentifier === machineId && device.owned
    )
  ) {
    throw new NotOwnerError('Token does not belong to the server owner');
  }

  return { machineId, name: status.MediaContainer.friendlyName };
};

const connectionError = (e: Error) => {
  logger.error('Something went wrong testing Plex server connection', {
    label: 'API',
    errorMessage: e.message,
  });
  return e instanceof NotOwnerError
    ? {
        status: 400,
        message: 'The signed-in Plex account does not own this server.',
      }
    : { status: 500, message: 'Unable to connect to Plex.' };
};

const syncLibraries = async (server: PlexServerSettings) => {
  try {
    await new PlexAPI({
      plexToken: server.ownerToken,
      plexSettings: server,
    }).syncLibraries(server.id);
  } catch (e) {
    logger.error('Failed to sync Plex server libraries', {
      label: 'API',
      server: server.name,
      errorMessage: e.message,
    });
  }
};

plexServerRoutes.get('/', (_req, res) => {
  return res.status(200).json(getSettings().plexServers.map(toPublic));
});

plexServerRoutes.post('/', async (req, res, next) => {
  const body = serverBodySchema.safeParse(req.body);
  if (!body.success || !body.data.ownerToken) {
    return next({ status: 400, message: 'Invalid request body.' });
  }

  const settings = getSettings();
  let identity: { machineId: string; name: string };
  try {
    identity = await identifyOwnedServer(body.data, body.data.ownerToken);
  } catch (e) {
    return next(connectionError(e));
  }

  if (
    settings.allPlexServers.some(
      (server) => server.machineId === identity.machineId
    )
  ) {
    return next({
      status: 409,
      message: 'This Plex server is already configured.',
    });
  }

  const server: PlexServerSettings = {
    id:
      Math.max(
        PRIMARY_PLEX_SERVER_ID,
        ...settings.plexServers.map((s) => s.id)
      ) + 1,
    name: identity.name,
    machineId: identity.machineId,
    ip: body.data.ip,
    port: body.data.port,
    useSsl: body.data.useSsl,
    webAppUrl: body.data.webAppUrl,
    ownerToken: body.data.ownerToken,
    libraries: [],
  };
  settings.plexServers = [...settings.plexServers, server];
  await syncLibraries(server);
  await settings.save();

  return res.status(201).json(toPublic(server));
});

plexServerRoutes.put<{ serverId: string }>(
  '/:serverId',
  async (req, res, next) => {
    const server = findServer(req.params.serverId);
    if (!server) {
      return next({ status: 404, message: 'Plex server does not exist.' });
    }

    const body = serverBodySchema.safeParse(req.body);
    const ownerToken = body.data?.ownerToken ?? server.ownerToken;
    if (!body.success || !ownerToken) {
      return next({ status: 400, message: 'Invalid request body.' });
    }

    const settings = getSettings();
    let identity: { machineId: string; name: string };
    try {
      identity = await identifyOwnedServer(body.data, ownerToken);
    } catch (e) {
      return next(connectionError(e));
    }

    if (
      settings.allPlexServers.some(
        (s) => s.id !== server.id && s.machineId === identity.machineId
      )
    ) {
      return next({
        status: 409,
        message: 'This Plex server is already configured.',
      });
    }

    // A different server behind this entry: its rating keys and libraries
    // belonged to the old one.
    if (identity.machineId !== server.machineId) {
      await getRepository(PlexServerItem).delete({ serverId: server.id });
      server.libraries = [];
    }

    Object.assign(server, {
      ...identity,
      ip: body.data.ip,
      port: body.data.port,
      useSsl: body.data.useSsl,
      webAppUrl: body.data.webAppUrl,
      ownerToken,
    });
    await syncLibraries(server);
    await settings.save();

    return res.status(200).json(toPublic(server));
  }
);

plexServerRoutes.delete<{ serverId: string }>(
  '/:serverId',
  async (req, res, next) => {
    const server = findServer(req.params.serverId);
    if (!server) {
      return next({ status: 404, message: 'Plex server does not exist.' });
    }

    const settings = getSettings();
    await getRepository(PlexServerItem).delete({ serverId: server.id });
    settings.plexServers = settings.plexServers.filter(
      (s) => s.id !== server.id
    );
    await settings.save();

    return res.status(204).send();
  }
);

plexServerRoutes.get<{ serverId: string }>(
  '/:serverId/library',
  (req, res, next) => {
    const server = findServer(req.params.serverId);
    if (!server) {
      return next({ status: 404, message: 'Plex server does not exist.' });
    }

    return res.status(200).json(server.libraries);
  }
);

plexServerRoutes.put<{ serverId: string; libraryId: string }>(
  '/:serverId/library/:libraryId',
  async (req, res, next) => {
    const server = findServer(req.params.serverId);
    const library = server?.libraries.find(
      (l) => l.id === req.params.libraryId
    );
    if (!library) {
      return next({ status: 404, message: 'Library does not exist.' });
    }

    const body = libraryUpdateSchema.safeParse(req.body);
    if (!body.success) {
      return next({ status: 400, message: 'Invalid request body.' });
    }

    library.enabled = body.data.enabled;
    await getSettings().save();

    return res.status(200).json(library);
  }
);

plexServerRoutes.post<{ serverId: string }>(
  '/:serverId/library/sync',
  async (req, res, next) => {
    const server = findServer(req.params.serverId);
    if (!server) {
      return next({ status: 404, message: 'Plex server does not exist.' });
    }

    try {
      await new PlexAPI({
        plexToken: server.ownerToken,
        plexSettings: server,
      }).syncLibraries(server.id);
    } catch (e) {
      return next({
        status: e.statusCode ?? 500,
        message: e.errorCode ?? 'Unable to sync Plex libraries.',
      });
    }
    await getSettings().save();

    return res.status(200).json(findServer(req.params.serverId)?.libraries);
  }
);

export default plexServerRoutes;
