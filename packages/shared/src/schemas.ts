import { z } from 'zod';
import { ENTRY_MODES, PLAN_TYPES, REACTION_KINDS, WORKSPACE_VIEWS } from './enums';
import { ISSUE_CODES } from './itinerary/validate';
import { isCurrencyCode } from './money';
import { planWindowErrors } from './plan-rules';

// Request schemas shared by the browser (form validation) and the API (the
// authoritative check). Unknown is modeled as absent/null — never defaulted.

export const idempotencyKey = z.string().min(8).max(64);
export const isoDate = z.iso.date();
export const currencyCode = z
  .string()
  .refine(isCurrencyCode, { message: 'Use a 3-letter currency code like CAD or USD.' });
export const moneySchema = z.object({
  amountMinor: z.number().int().min(0).max(10_000_000_00),
  currency: currencyCode,
});
const minuteOfDay = z.number().int().min(0).max(1439);
const endMinute = z.number().int().min(1).max(2880);

// ─── Plans ──────────────────────────────────────────────────────────────────

export const createPlanInput = z
  .object({
    clientRequestId: idempotencyKey,
    type: z.enum(PLAN_TYPES),
    name: z.string().trim().max(80).optional(),
    city: z.string().trim().max(120).optional(),
    timezone: z.string().max(64).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    startMin: minuteOfDay.optional(),
    endMin: endMinute.optional(),
    budget: moneySchema.optional(),
  })
  .superRefine((v, ctx) => {
    for (const e of planWindowErrors({
      type: v.type,
      startDate: v.startDate ?? null,
      endDate: v.endDate ?? null,
      startMin: v.startMin ?? null,
      endMin: v.endMin ?? null,
    })) {
      ctx.addIssue({ code: 'custom', path: [e.path], message: e.message });
    }
  });
export type CreatePlanInput = z.infer<typeof createPlanInput>;

export const updatePlanInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    city: z.string().trim().max(120).nullable(),
    timezone: z.string().max(64).nullable(),
    startDate: isoDate.nullable(),
    endDate: isoDate.nullable(),
    startMin: minuteOfDay.nullable(),
    endMin: endMinute.nullable(),
    budget: moneySchema.nullable(),
    entryMode: z.enum(ENTRY_MODES),
  })
  .partial();
export type UpdatePlanInput = z.infer<typeof updatePlanInput>;

export const lastViewInput = z.object({ view: z.enum(WORKSPACE_VIEWS) });

// ─── Ideas ──────────────────────────────────────────────────────────────────

export const placeInput = z
  .object({
    name: z.string().trim().min(1).max(140),
    address: z.string().trim().max(240).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    category: z.string().trim().max(60).optional(),
  })
  .refine((p) => (p.lat == null) === (p.lng == null), {
    message: 'Latitude and longitude go together.',
    path: ['lat'],
  });
export type PlaceInput = z.infer<typeof placeInput>;

const ideaCommon = {
  clientRequestId: idempotencyKey,
  note: z.string().trim().max(2000).optional(),
  /** Attach this idea's sources to an existing idea instead of creating a new card. */
  mergeIntoIdeaId: z.string().max(64).optional(),
};

export const createIdeaInput = z.discriminatedUnion('kind', [
  z.object({
    ...ideaCommon,
    kind: z.literal('PLACE'),
    place: placeInput,
    sourceUrl: z.string().max(2048).optional(),
  }),
  z.object({
    ...ideaCommon,
    kind: z.literal('LINK'),
    url: z.string().min(1).max(2048),
    title: z.string().trim().max(140).optional(),
  }),
  z.object({ ...ideaCommon, kind: z.literal('NOTE'), title: z.string().trim().min(1).max(140) }),
  z.object({
    ...ideaCommon,
    kind: z.literal('ACTIVITY'),
    title: z.string().trim().min(1).max(140),
    place: placeInput.optional(),
  }),
]);
export type CreateIdeaInput = z.infer<typeof createIdeaInput>;

export const previewIdeaInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('LINK'), url: z.string().min(1).max(2048) }),
  z.object({ kind: z.literal('PLACE'), place: placeInput }),
]);
export type PreviewIdeaInput = z.infer<typeof previewIdeaInput>;

export const updateIdeaInput = z
  .object({
    title: z.string().trim().min(1).max(140),
    note: z.string().trim().max(2000).nullable(),
    shortlisted: z.boolean(),
    durationMin: z.number().int().min(5).max(1440).nullable(),
    cost: moneySchema.nullable(),
  })
  .partial();
export type UpdateIdeaInput = z.infer<typeof updateIdeaInput>;

export const reactionInput = z.object({ kind: z.enum(REACTION_KINDS).nullable() });

// ─── Itinerary ──────────────────────────────────────────────────────────────

export const draftStopSchema = z.object({
  id: z.string().min(1).max(64),
  ideaId: z.string().max(64).nullable(),
  title: z.string().trim().min(1).max(140),
  position: z.string().min(1).max(64),
  dayIndex: z.number().int().min(0).max(60),
  durationMin: z.number().int().min(0).max(2880),
  fixedStartMin: z.number().int().min(0).max(2879).nullable(),
  locked: z.boolean(),
  travelMinFromPrev: z.number().int().min(0).max(1440).nullable(),
  costMinor: z.number().int().min(0).nullable(),
  costCurrency: currencyCode.nullable(),
});

export const commitItineraryInput = z
  .object({
    /** The confirmed version this draft was reviewed against. */
    expectedVersion: z.number().int().min(0),
    stops: z.array(draftStopSchema).max(200),
    note: z.string().trim().max(280).optional(),
    /** Hard-constraint errors the user explicitly chose to confirm anyway. */
    acceptedIssueCodes: z.array(z.enum(ISSUE_CODES)).default([]),
  })
  .refine((v) => new Set(v.stops.map((s) => s.id)).size === v.stops.length, {
    message: 'Stop ids must be unique.',
    path: ['stops'],
  });
export type CommitItineraryInput = z.infer<typeof commitItineraryInput>;

// ─── Planning contract (consumed by the Phase 3 planning worker) ───────────

export const planConstraintsSchema = z.object({
  date: isoDate.nullable(),
  startMin: minuteOfDay.nullable(),
  endMin: endMinute.nullable(),
  timezone: z.string().nullable(),
  origin: z.object({ label: z.string(), lat: z.number().optional(), lng: z.number().optional() }).nullable(),
  transport: z.enum(['WALK', 'TRANSIT', 'DRIVE', 'BIKE', 'MIXED']).nullable(),
  budget: moneySchema.nullable(),
  mustInclude: z.array(z.string()),
  hardRestrictions: z.array(z.string()),
  preferences: z.array(z.string()),
  lockedStopIds: z.array(z.string()),
  ideaIds: z.array(z.string()),
  /** Fields the user has not told us. Planned with as unknown, never guessed. */
  missing: z.array(z.string()),
});
export type PlanConstraints = z.infer<typeof planConstraintsSchema>;
