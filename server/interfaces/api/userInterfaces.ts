import type Media from '@server/entity/Media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import type { PlexServerRef } from '@server/lib/plexServerMembership';
import type { PaginatedResponse } from './common';

export interface UserResultsResponse extends PaginatedResponse {
  /** plexServers is set only when more than one Plex server exists. */
  results: (User & { plexServers?: PlexServerRef[] })[];
}

export interface UserRequestsResponse extends PaginatedResponse {
  results: MediaRequest[];
}

export interface QuotaStatus {
  days?: number;
  limit?: number;
  used: number;
  remaining?: number;
  restricted: boolean;
}

export interface QuotaResponse {
  movie: QuotaStatus;
  tv: QuotaStatus;
}

export interface UserWatchDataResponse {
  recentlyWatched: Media[];
  playCount: number;
}
