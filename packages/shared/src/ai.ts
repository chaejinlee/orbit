import { z } from 'zod';
import type { PersonDTO } from './api-types';
import type { ItineraryIssue } from './itinerary/validate';
import type { Money } from './money';
import type { Pace, PlannedStop, ProposalLabelName, ProposalTotals, SkippedIdea } from './planner/planner';
import { draftStopSchema, idempotencyKey } from './schemas';

// Orbit AI: request schemas and DTOs shared by the browser and the API.
// Everything here is button-first: a chip is one tap; typing is optional.

// ─── Ask Orbit (questions about one card) ──────────────────────────────────

export const ASK_PRESETS = ['HOURS', 'PRICE', 'RESERVATIONS', 'GETTING_THERE', 'TIPS'] as const;
export type AskPreset = (typeof ASK_PRESETS)[number];

export const ASK_PRESET_LABEL: Record<AskPreset, string> = {
  HOURS: 'Hours',
  PRICE: 'Price',
  RESERVATIONS: 'Reservations',
  GETTING_THERE: 'Getting there',
  TIPS: 'Good to know',
};

export const askInput = z
  .object({
    clientRequestId: idempotencyKey,
    preset: z.enum(ASK_PRESETS).optional(),
    question: z.string().trim().min(3, 'Ask a slightly longer question.').max(280).optional(),
  })
  .refine((v) => !!v.preset !== !!v.question, { message: 'Pick a quick question or type your own.' });
export type AskInput = z.infer<typeof askInput>;

export type AiSourceProvider = 'google_maps' | 'web';

export interface AiSourceDTO {
  url: string;
  title: string | null;
  provider: AiSourceProvider | null;
}

export interface AiAnswerDTO {
  id: string;
  ideaId: string;
  question: string;
  preset: AskPreset | null;
  answer: string;
  sources: AiSourceDTO[];
  /**
   * Where the facts were looked up. null = Gemini answered from general
   * knowledge without checking anything (the key can't use grounding).
   */
  checkedWith: 'google_maps' | 'google_search' | null;
  /** When the sources were checked; null when nothing was checked. */
  checkedAt: string | null;
  visibility: 'PRIVATE' | 'SHARED';
  /** True when the asker is the current user (only they can share it). */
  mine: boolean;
  requestedBy: PersonDTO;
  sharedBy: PersonDTO | null;
  sharedAt: string | null;
  createdAt: string;
}

// ─── Plan options (I01/I02) ─────────────────────────────────────────────────

export const PROPOSAL_CHIPS = ['RELAXED', 'PACKED', 'LESS_TRAVEL', 'CHEAPER'] as const;
export type ProposalChip = (typeof PROPOSAL_CHIPS)[number];

export const PROPOSAL_CHIP_LABEL: Record<ProposalChip, string> = {
  RELAXED: 'Relaxed pace',
  PACKED: 'Fit in more',
  LESS_TRAVEL: 'Less travel',
  CHEAPER: 'Spend less',
};

export const PROPOSAL_LABEL_NAME: Record<ProposalLabelName, string> = {
  BALANCED: 'Balanced',
  BUDGET: 'Budget',
  EXPERIENCE: 'Experience',
};

export const proposalsInput = z
  .object({
    clientRequestId: idempotencyKey,
    /** The shared draft as the requester sees it (locked stops are kept). */
    draft: z.array(draftStopSchema).max(80),
    chips: z.array(z.enum(PROPOSAL_CHIPS)).max(PROPOSAL_CHIPS.length),
    /** Optional free text. Only read when AI is on. */
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => !(v.chips.includes('RELAXED') && v.chips.includes('PACKED')), {
    message: 'Pick either a relaxed day or a packed one.',
  });
export type ProposalsInput = z.infer<typeof proposalsInput>;

export type WindowSource = 'plan' | 'note' | 'assumed';

export interface ProposalDTO {
  id: string;
  label: ProposalLabelName;
  headline: string;
  /** One sentence from the AI, grounded in the facts below. Null without AI. */
  why: string | null;
  stops: PlannedStop[];
  skipped: SkippedIdea[];
  totals: ProposalTotals;
  issues: ItineraryIssue[];
  tradeoffs: string[];
}

export interface IdeaRefDTO {
  ideaId: string;
  title: string;
}

/** "What Orbit understood": every preference used, so nothing is hidden. */
export interface UnderstoodDTO {
  chips: ProposalChip[];
  pace: Pace;
  lessTravel: boolean;
  lowerCost: boolean;
  mustInclude: IdeaRefDTO[];
  avoid: IdeaRefDTO[];
  endWith: IdeaRefDTO | null;
  maxStops: number | null;
  window: { startMin: number; endMin: number; source: WindowSource };
  budget: Money | null;
  budgetSource: 'plan' | 'note' | null;
  /** Parts of the note Orbit can't act on yet. */
  notUnderstood: string[];
  noteUsed: boolean;
}

export interface ProposalsResultDTO {
  jobId: string;
  basePlanVersion: number;
  proposals: ProposalDTO[];
  problems: string[];
  understood: UnderstoodDTO;
  ai: { used: boolean; model: string | null; notice: string | null };
  generatedAt: string;
}

// ─── Status ─────────────────────────────────────────────────────────────────

export interface AiStatusDTO {
  enabled: boolean;
  provider: 'gemini' | 'fake' | null;
  model: string | null;
  dailyLimit: number;
  usedToday: number;
}
