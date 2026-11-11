import type {
  CommitSource,
  EntryMode,
  IdeaKind,
  MemberRole,
  PlaceProvider,
  PlanStatus,
  PlanType,
  ReactionKind,
  SourceKind,
  Verification,
  WorkspaceView,
} from './enums';
import type { MatchConfidence, DuplicateReason } from './dedupe';
import type { ItineraryIssue } from './itinerary/validate';
import type { LinkPlatform } from './links';
import type { Money } from './money';

// Response shapes of the HTTP API. Dates are ISO strings; plan dates are
// YYYY-MM-DD; times are minutes after local midnight.

export interface PersonDTO {
  id: string;
  name: string;
  color: string;
}

export interface MeDTO extends PersonDTO {
  email: string;
}

export interface AuthResultDTO {
  token: string;
  user: MeDTO;
}

/**
 * GET /v1/auth/phone, answered only on the computer running Orbit.
 * `enabled: false` means the servers listen on this computer only (start them
 * with `npm run dev:phone` to open Orbit on a phone on the same Wi-Fi).
 */
export type PhoneAccessDTO =
  | { enabled: false }
  | {
      enabled: true;
      /** http://<this computer's Wi-Fi address>:<web port>, most likely first. */
      urls: string[];
      /** Six digits a phone enters once to sign in. New each time the API starts. */
      code: string;
    };

export interface MemberDTO extends PersonDTO {
  role: MemberRole;
}

export interface PlanSummaryDTO {
  id: string;
  type: PlanType;
  name: string;
  status: PlanStatus;
  city: string | null;
  startDate: string | null;
  endDate: string | null;
  startMin: number | null;
  endMin: number | null;
  budget: Money | null;
  currentVersion: number;
  myRole: MemberRole;
  lastView: WorkspaceView | null;
  members: MemberDTO[];
  ideaCount: number;
  updatedAt: string;
}

export interface PlanDTO extends PlanSummaryDTO {
  timezone: string | null;
  entryMode: EntryMode | null;
  createdAt: string;
}

export interface PlaceDTO {
  id: string;
  provider: PlaceProvider;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  category: string | null;
  verification: Verification;
  fetchedAt: string | null;
}

export interface IdeaSourceDTO {
  id: string;
  kind: SourceKind;
  url: string | null;
  platform: LinkPlatform | null;
  title: string | null;
  note: string | null;
  addedBy: PersonDTO;
  createdAt: string;
}

export interface IdeaDTO {
  id: string;
  planId: string;
  kind: IdeaKind;
  title: string;
  note: string | null;
  shortlisted: boolean;
  durationMin: number | null;
  cost: Money | null;
  place: PlaceDTO | null;
  sources: IdeaSourceDTO[];
  interested: PersonDTO[];
  notInterestedCount: number;
  myReaction: ReactionKind | null;
  /** Comments on this card that haven't been deleted. */
  commentCount: number;
  createdBy: PersonDTO;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface DuplicateCandidateDTO {
  ideaId: string;
  title: string;
  confidence: MatchConfidence;
  reasons: Array<DuplicateReason | 'same_link'>;
  distanceM?: number;
}

export interface IdeaPreviewDTO {
  link: { url: string; host: string; platform: LinkPlatform } | null;
  /** Place details read from the URL itself (maps links), if any. */
  parsedPlace: { name?: string; lat?: number; lng?: number } | null;
  duplicates: DuplicateCandidateDTO[];
}

export interface CreateIdeaResultDTO {
  idea: IdeaDTO;
  /** True when the input was attached to an existing idea as a new source. */
  merged: boolean;
  /** True when this request was a retry of one that already succeeded. */
  replayed: boolean;
}

export interface ItineraryStopDTO {
  key: string;
  ideaId: string | null;
  title: string;
  dayIndex: number;
  sequence: number;
  startMin: number | null;
  durationMin: number;
  travelMinFromPrev: number | null;
  fixedStartMin: number | null;
  locked: boolean;
  cost: Money | null;
}

export interface ItineraryVersionSummaryDTO {
  version: number;
  source: CommitSource;
  note: string | null;
  committedBy: PersonDTO;
  committedAt: string;
  stopCount: number;
}

export interface ItineraryVersionDTO extends Omit<ItineraryVersionSummaryDTO, 'stopCount'> {
  stops: ItineraryStopDTO[];
}

export interface ItineraryStateDTO {
  currentVersion: number;
  current: ItineraryVersionDTO | null;
  history: ItineraryVersionSummaryDTO[];
}

/** 409 body: someone confirmed another version since this draft was reviewed. */
export interface VersionConflictDTO {
  code: 'VERSION_CONFLICT';
  message: string;
  expectedVersion: number;
  currentVersion: number;
}

/** 422 body: hard constraints failed and were not explicitly accepted. */
export interface ConstraintsFailedDTO {
  code: 'CONSTRAINTS_FAILED';
  message: string;
  issues: ItineraryIssue[];
}
