import type {
  AiAnswerDTO,
  AiStatusDTO,
  AskInput,
  AuthResultDTO,
  CommentDTO,
  CreateCommentInput,
  CreatedInviteDTO,
  CreateIdeaInput,
  CreateInviteInput,
  CreateIdeaResultDTO,
  CreatePlanInput,
  IdeaDTO,
  IdeaPreviewDTO,
  InviteDTO,
  InvitePreviewDTO,
  InviteRole,
  ItineraryIssue,
  ItineraryStateDTO,
  ItineraryVersionDTO,
  IssueCode,
  DraftStop,
  JoinResultDTO,
  MeDTO,
  PhoneAccessDTO,
  PhotoDTO,
  PlanDTO,
  PreviewIdeaInput,
  ProposalsInput,
  ProposalsResultDTO,
  ReactionKind,
  UpdateIdeaInput,
  UpdatePlanInput,
  WorkspaceView,
} from '@orbit/shared';
import { randomId, withPageHost } from '@orbit/shared';

// A phone that opened http://192.168.x.y:3000 reaches the servers through that
// same host; a configured "localhost" would be the phone itself.
const pageHost = typeof window === 'undefined' ? null : window.location.hostname;
export const API_URL = withPageHost(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000', pageHost);
export const REALTIME_URL = withPageHost(process.env.NEXT_PUBLIC_REALTIME_URL ?? 'ws://localhost:4001', pageHost);

export interface ApiErrorBody {
  message: string;
  code?: string;
  issues?: ItineraryIssue[] | Array<{ path: string; message: string }>;
  currentVersion?: number;
  expectedVersion?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
  get code(): string | undefined {
    return this.body.code;
  }
}

let sessionToken: string | null = null;
let onUnauthorized: () => void = () => {};

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init: { method?: string; body?: unknown; file?: Blob } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.file) headers['content-type'] = init.file.type || 'application/octet-stream';
  else if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.file ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: 'Can’t reach Orbit right now. Check your connection and try again.' });
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody>;
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    throw new ApiError(res.status, { ...data, message: data.message ?? 'Something went wrong.' });
  }
  return data as T;
}

const enc = encodeURIComponent;

export interface CommitRequest {
  expectedVersion: number;
  stops: DraftStop[];
  note?: string;
  acceptedIssueCodes?: IssueCode[];
}

export const api = {
  devLogin: (email: string, name?: string, phoneCode?: string) =>
    request<AuthResultDTO>('/auth/dev-login', {
      method: 'POST',
      body: { email, ...(name ? { name } : {}), ...(phoneCode ? { phoneCode } : {}) },
    }),
  me: () => request<MeDTO>('/auth/me'),
  /** How to open Orbit on a phone. Answers only on the computer running Orbit. */
  phoneAccess: () => request<PhoneAccessDTO>('/auth/phone'),

  plans: () => request<PlanDTO[]>('/plans'),
  createPlan: (input: CreatePlanInput) => request<PlanDTO>('/plans', { method: 'POST', body: input }),
  plan: (planId: string) => request<PlanDTO>(`/plans/${enc(planId)}`),
  updatePlan: (planId: string, patch: UpdatePlanInput) =>
    request<PlanDTO>(`/plans/${enc(planId)}`, { method: 'PATCH', body: patch }),
  setLastView: (planId: string, view: WorkspaceView) =>
    request<void>(`/plans/${enc(planId)}/last-view`, { method: 'PUT', body: { view } }),

  ideas: (planId: string) => request<IdeaDTO[]>(`/plans/${enc(planId)}/ideas?includeArchived=true`),
  previewIdea: (planId: string, input: PreviewIdeaInput) =>
    request<IdeaPreviewDTO>(`/plans/${enc(planId)}/ideas/preview`, { method: 'POST', body: input }),
  createIdea: (planId: string, input: CreateIdeaInput) =>
    request<CreateIdeaResultDTO>(`/plans/${enc(planId)}/ideas`, { method: 'POST', body: input }),
  updateIdea: (planId: string, ideaId: string, patch: UpdateIdeaInput) =>
    request<IdeaDTO>(`/plans/${enc(planId)}/ideas/${enc(ideaId)}`, { method: 'PATCH', body: patch }),
  archiveIdea: (planId: string, ideaId: string, archived: boolean) =>
    request<IdeaDTO>(`/plans/${enc(planId)}/ideas/${enc(ideaId)}/${archived ? 'archive' : 'restore'}`, {
      method: 'POST',
    }),
  reactToIdea: (planId: string, ideaId: string, kind: ReactionKind | null) =>
    request<IdeaDTO>(`/plans/${enc(planId)}/ideas/${enc(ideaId)}/reaction`, { method: 'PUT', body: { kind } }),

  itinerary: (planId: string) => request<ItineraryStateDTO>(`/plans/${enc(planId)}/itinerary`),
  itineraryVersion: (planId: string, version: number) =>
    request<ItineraryVersionDTO>(`/plans/${enc(planId)}/itinerary/versions/${version}`),
  commitItinerary: (planId: string, input: CommitRequest) =>
    request<ItineraryVersionDTO>(`/plans/${enc(planId)}/itinerary/commits`, { method: 'POST', body: input }),

  aiStatus: () => request<AiStatusDTO>('/ai/status'),
  proposals: (planId: string, input: ProposalsInput) =>
    request<ProposalsResultDTO>(`/plans/${enc(planId)}/proposals`, { method: 'POST', body: input }),
  askOrbit: (planId: string, ideaId: string, input: AskInput) =>
    request<AiAnswerDTO>(`/plans/${enc(planId)}/ideas/${enc(ideaId)}/ask`, { method: 'POST', body: input }),
  answers: (planId: string, ideaId: string) => request<AiAnswerDTO[]>(`/plans/${enc(planId)}/ideas/${enc(ideaId)}/answers`),
  shareAnswer: (planId: string, answerId: string) =>
    request<AiAnswerDTO>(`/plans/${enc(planId)}/answers/${enc(answerId)}/share`, { method: 'POST' }),
  hideAnswer: (planId: string, answerId: string) =>
    request<void>(`/plans/${enc(planId)}/answers/${enc(answerId)}/hide`, { method: 'POST' }),

  invites: (planId: string) => request<InviteDTO[]>(`/plans/${enc(planId)}/invites`),
  createInvite: (planId: string, input: CreateInviteInput) =>
    request<CreatedInviteDTO>(`/plans/${enc(planId)}/invites`, { method: 'POST', body: input }),
  revokeInvite: (planId: string, inviteId: string) =>
    request<void>(`/plans/${enc(planId)}/invites/${enc(inviteId)}/revoke`, { method: 'POST' }),
  /** Public; sends the session too when there is one, to learn if you're already in. */
  previewInvite: (token: string) => request<InvitePreviewDTO>('/invites/preview', { method: 'POST', body: { token } }),
  acceptInvite: (token: string) => request<JoinResultDTO>('/invites/accept', { method: 'POST', body: { token } }),
  changeMemberRole: (planId: string, userId: string, role: InviteRole) =>
    request<PlanDTO>(`/plans/${enc(planId)}/members/${enc(userId)}`, { method: 'PATCH', body: { role } }),
  removeMember: (planId: string, userId: string) =>
    request<void>(`/plans/${enc(planId)}/members/${enc(userId)}`, { method: 'DELETE' }),
  leavePlan: (planId: string) => request<void>(`/plans/${enc(planId)}/leave`, { method: 'POST' }),

  photos: (planId: string) => request<PhotoDTO[]>(`/plans/${enc(planId)}/photos`),
  /** The body is the (already shrunk) photo itself. */
  uploadPhoto: (planId: string, photo: Blob, clientRequestId: string) =>
    request<PhotoDTO>(`/plans/${enc(planId)}/photos?clientRequestId=${enc(clientRequestId)}`, { method: 'POST', file: photo }),

  comments: (planId: string, ideaId: string) => request<CommentDTO[]>(`/plans/${enc(planId)}/ideas/${enc(ideaId)}/comments`),
  createComment: (planId: string, ideaId: string, input: CreateCommentInput) =>
    request<CommentDTO>(`/plans/${enc(planId)}/ideas/${enc(ideaId)}/comments`, { method: 'POST', body: input }),
  updateComment: (planId: string, commentId: string, content: string) =>
    request<CommentDTO>(`/plans/${enc(planId)}/comments/${enc(commentId)}`, { method: 'PATCH', body: { content } }),
  deleteComment: (planId: string, commentId: string) =>
    request<void>(`/plans/${enc(planId)}/comments/${enc(commentId)}`, { method: 'DELETE' }),
};

/** A photo's signed link (a path under the API) as a URL an <img> can load. */
export function photoSrc(path: string): string {
  return `${API_URL}${path}`;
}

export function newRequestId(): string {
  return randomId();
}
