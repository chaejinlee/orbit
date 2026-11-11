// Demo data: two people planning a Saturday date. Sign in as demo@orbit.dev
// (owner) or sam@orbit.dev (editor) with the development sign-in.
// Businesses are fictional; costs are the kind of estimates a user types in.

import * as Y from 'yjs';
import { mapsSearchUrl, normalizeLink } from '@orbit/shared';
import { addDraftStop, docNameForPlan, initBoardDoc, placeIdeaNode } from '@orbit/shared/yboard';
import { createPrismaClient } from './index';

const prisma = createPrismaClient();
const SEED_KEY = 'seed-saturday-date';

async function main() {
  const demo = await prisma.user.upsert({
    where: { email: 'demo@orbit.dev' },
    update: {},
    create: { email: 'demo@orbit.dev', name: 'Demo', color: 'lilac', timezone: 'America/Toronto' },
  });
  const sam = await prisma.user.upsert({
    where: { email: 'sam@orbit.dev' },
    update: {},
    create: { email: 'sam@orbit.dev', name: 'Sam', color: 'peach', timezone: 'America/Toronto' },
  });

  const existing = await prisma.plan.findUnique({
    where: { createdById_clientRequestId: { createdById: demo.id, clientRequestId: SEED_KEY } },
  });
  if (existing) {
    console.log('Seed data already exists — nothing to do.');
    return;
  }

  // One transaction: a failed seed leaves nothing half-created.
  const plan = await prisma.$transaction(
    async (tx) => {
      const plan = await tx.plan.create({
        data: {
          type: 'DATE',
          name: 'Saturday Date',
          status: 'PLANNING',
          city: 'Toronto',
          timezone: 'America/Toronto',
          startDate: new Date('2026-11-14'),
          endDate: new Date('2026-11-14'),
          startMin: 15 * 60,
          endMin: 21 * 60,
          budgetMinor: 12000,
          budgetCurrency: 'CAD',
          entryMode: 'MANUAL',
          createdById: demo.id,
          clientRequestId: SEED_KEY,
          members: {
            create: [
              { userId: demo.id, role: 'OWNER', lastView: 'board' },
              { userId: sam.id, role: 'EDITOR' },
            ],
          },
          aiSettings: { create: {} },
          events: { create: { type: 'plan.created', actorId: demo.id } },
        },
      });

      const idea = async (
        key: string,
        data: {
          kind: 'PLACE' | 'LINK' | 'NOTE' | 'ACTIVITY';
          title: string;
          note?: string;
          createdById: string;
          shortlisted?: boolean;
          durationMin?: number;
          costMinor?: number;
          place?: { name: string; address?: string; lat?: number; lng?: number; category?: string };
          sourceUrl?: string;
        },
      ) => {
        const link = data.sourceUrl ? normalizeLink(data.sourceUrl) : null;
        const place = data.place
          ? await tx.placeRef.create({ data: { provider: 'MANUAL', ...data.place } })
          : null;
        return tx.idea.create({
          data: {
            planId: plan.id,
            kind: data.kind,
            title: data.title,
            note: data.note ?? null,
            shortlisted: data.shortlisted ?? false,
            durationMin: data.durationMin ?? null,
            costMinor: data.costMinor ?? null,
            costCurrency: data.costMinor != null ? 'CAD' : null,
            createdById: data.createdById,
            clientRequestId: `${SEED_KEY}-${key}`,
            placeRefId: place?.id ?? null,
            sources: link
              ? {
                  create: {
                    planId: plan.id,
                    kind: 'LINK',
                    url: link.url,
                    urlKey: link.key,
                    platform: link.platform,
                    addedById: data.createdById,
                  },
                }
              : undefined,
          },
        });
      };

      const cafe = await idea('cafe', {
        kind: 'PLACE',
        title: 'Sunday Pages Café',
        note: 'Cozy spot to start — they do pour-over and tiny pastries.',
        createdById: sam.id,
        shortlisted: true,
        durationMin: 60,
        costMinor: 1800,
        place: { name: 'Sunday Pages Café', address: 'Queen St W, Toronto', lat: 43.6487, lng: -79.3965, category: 'Café' },
      });
      const gallery = await idea('gallery', {
        kind: 'ACTIVITY',
        title: 'Art Gallery of Ontario',
        note: 'Check if there’s a special exhibition that weekend.',
        createdById: demo.id,
        durationMin: 90,
        place: { name: 'Art Gallery of Ontario', address: 'Dundas St W, Toronto', lat: 43.6536, lng: -79.3925, category: 'Museum' },
      });
      const dinner = await idea('dinner', {
        kind: 'PLACE',
        title: 'Hanok Table',
        note: '분위기 좋아 보여. 여기 가고 싶어!',
        createdById: demo.id,
        shortlisted: true,
        durationMin: 90,
        costMinor: 8500,
        place: { name: 'Hanok Table', address: 'Bloor St W, Toronto', lat: 43.6629, lng: -79.4146, category: 'Korean' },
        sourceUrl: mapsSearchUrl({ name: 'Hanok Table Toronto' }),
      });
      const picnic = await idea('picnic', {
        kind: 'NOTE',
        title: 'Picnic at Trinity Bellwoods',
        note: 'Only if the weather is nice.',
        createdById: sam.id,
      });
      const dessert = await idea('dessert', {
        kind: 'LINK',
        title: 'Dessert spots list',
        createdById: sam.id,
        sourceUrl: 'https://example.com/dessert-spots?utm_source=instagram',
      });

      await tx.ideaReaction.createMany({
        data: [
          { ideaId: dinner.id, userId: demo.id, kind: 'INTERESTED' },
          { ideaId: dinner.id, userId: sam.id, kind: 'INTERESTED' },
          { ideaId: cafe.id, userId: demo.id, kind: 'INTERESTED' },
        ],
      });

      // Board layout + shared draft live in the plan's Yjs document.
      const doc = new Y.Doc();
      initBoardDoc(doc);
      placeIdeaNode(doc, cafe.id, { x: 0, y: 0 });
      placeIdeaNode(doc, gallery.id, { x: 300, y: 40 });
      placeIdeaNode(doc, dinner.id, { x: 620, y: 0 });
      placeIdeaNode(doc, picnic.id, { x: 60, y: 260 });
      placeIdeaNode(doc, dessert.id, { x: 380, y: 300 });
      const stop = { fixedStartMin: null, locked: false, travelMinFromPrev: null, costMinor: null, costCurrency: null };
      addDraftStop(doc, { ...stop, ideaId: cafe.id, title: cafe.title, durationMin: 60, costMinor: 1800, costCurrency: 'CAD' });
      addDraftStop(doc, { ...stop, ideaId: gallery.id, title: gallery.title, durationMin: 90, travelMinFromPrev: 15 });
      addDraftStop(doc, {
        ...stop,
        ideaId: dinner.id,
        title: dinner.title,
        durationMin: 90,
        fixedStartMin: 19 * 60,
        locked: true,
        costMinor: 8500,
        costCurrency: 'CAD',
      });
      await tx.canvasDocument.create({
        data: { planId: plan.id, state: new Uint8Array(Y.encodeStateAsUpdate(doc)) },
      });

      return plan;
    },
    { timeout: 30_000 },
  );

  console.log(`Seeded "${plan.name}" (${docNameForPlan(plan.id)}). Sign in as demo@orbit.dev or sam@orbit.dev.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
