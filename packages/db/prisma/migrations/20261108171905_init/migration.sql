-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('DATE', 'HANGOUT', 'TRIP', 'EVENT');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PLANNING', 'CONFIRMED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EntryMode" AS ENUM ('MANUAL', 'AI');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "IdeaKind" AS ENUM ('PLACE', 'LINK', 'NOTE', 'ACTIVITY');

-- CreateEnum
CREATE TYPE "PlaceProvider" AS ENUM ('MANUAL', 'GOOGLE', 'FOURSQUARE', 'OSM');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('LINK', 'PHOTO', 'NOTE');

-- CreateEnum
CREATE TYPE "Verification" AS ENUM ('VERIFIED', 'NEEDS_RECHECK', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ReactionKind" AS ENUM ('INTERESTED', 'NOT_INTERESTED');

-- CreateEnum
CREATE TYPE "CommitSource" AS ENUM ('DRAFT', 'PROPOSAL', 'REPLAN', 'REVERT');

-- CreateEnum
CREATE TYPE "ConstraintStrength" AS ENUM ('HARD', 'SOFT');

-- CreateEnum
CREATE TYPE "ConstraintVisibility" AS ENUM ('GROUP', 'PRIVATE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProposalLabel" AS ENUM ('BUDGET', 'BALANCED', 'EXPERIENCE');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('READY', 'STALE', 'REJECTED', 'COMMITTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CommentKind" AS ENUM ('HUMAN', 'AI_RESPONSE');

-- CreateEnum
CREATE TYPE "AiMode" AS ENUM ('ON_DEMAND', 'SUGGEST', 'SMART_AUTO');

-- CreateEnum
CREATE TYPE "AiChannel" AS ENUM ('ASK_BUTTON', 'SUGGESTION_CHIP', 'MENTION', 'AUTO');

-- CreateEnum
CREATE TYPE "AiVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- CreateEnum
CREATE TYPE "AiResponseStatus" AS ENUM ('PENDING', 'ANSWERED', 'ABSTAINED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiDecision" AS ENUM ('IGNORE', 'SUGGEST', 'VERIFY_FACT');

-- CreateEnum
CREATE TYPE "AiFinalAction" AS ENUM ('AUTO_REPLY', 'SUGGEST_ONLY', 'ABSTAIN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'lilac',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "type" "PlanType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "city" TEXT,
    "timezone" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "startMin" INTEGER,
    "endMin" INTEGER,
    "budgetMinor" INTEGER,
    "budgetCurrency" CHAR(3),
    "entryMode" "EntryMode",
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_members" (
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "lastView" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_members_pkey" PRIMARY KEY ("planId","userId")
);

-- CreateTable
CREATE TABLE "invite_links" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "place_refs" (
    "id" TEXT NOT NULL,
    "provider" "PlaceProvider" NOT NULL,
    "externalId" TEXT,
    "name" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "category" TEXT,
    "verification" "Verification" NOT NULL DEFAULT 'UNKNOWN',
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "place_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideas" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" "IdeaKind" NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "placeRefId" TEXT,
    "shortlisted" BOOLEAN NOT NULL DEFAULT false,
    "durationMin" INTEGER,
    "costMinor" INTEGER,
    "costCurrency" CHAR(3),
    "createdById" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "mergedIntoId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_sources" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "url" TEXT,
    "urlKey" TEXT,
    "platform" TEXT,
    "title" TEXT,
    "note" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_reactions" (
    "ideaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ReactionKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_reactions_pkey" PRIMARY KEY ("ideaId","userId")
);

-- CreateTable
CREATE TABLE "itinerary_versions" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" "CommitSource" NOT NULL,
    "proposalId" TEXT,
    "note" TEXT,
    "committedById" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itinerary_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itinerary_stops" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ideaId" TEXT,
    "title" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL DEFAULT 0,
    "sequence" INTEGER NOT NULL,
    "startMin" INTEGER,
    "durationMin" INTEGER NOT NULL,
    "travelMinFromPrev" INTEGER,
    "fixedStartMin" INTEGER,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "costMinor" INTEGER,
    "costCurrency" CHAR(3),

    CONSTRAINT "itinerary_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polls" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_options" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "ideaId" TEXT,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "votes" (
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("pollId","userId")
);

-- CreateTable
CREATE TABLE "member_constraints" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "strength" "ConstraintStrength" NOT NULL,
    "category" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "visibility" "ConstraintVisibility" NOT NULL DEFAULT 'GROUP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_constraints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning_jobs" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "constraints" JSONB NOT NULL,
    "basePlanVersion" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "planning_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_proposals" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "label" "ProposalLabel" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'READY',
    "basePlanVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "plan_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "parentId" TEXT,
    "authorId" TEXT NOT NULL,
    "kind" "CommentKind" NOT NULL DEFAULT 'HUMAN',
    "content" TEXT NOT NULL,
    "aiResponseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_responses" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "triggerCommentId" TEXT,
    "requestedById" TEXT NOT NULL,
    "channel" "AiChannel" NOT NULL,
    "visibility" "AiVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "AiResponseStatus" NOT NULL DEFAULT 'PENDING',
    "questionSnapshot" TEXT NOT NULL,
    "answer" TEXT,
    "checkedAt" TIMESTAMP(3),
    "sharedById" TEXT,
    "sharedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "feedback" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_sources" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "provider" TEXT,
    "accessedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_interventions" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "mode" "AiMode" NOT NULL,
    "label" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "decision" "AiDecision" NOT NULL,
    "finalAction" "AiFinalAction",
    "reasonCode" TEXT,
    "responseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_ai_settings" (
    "planId" TEXT NOT NULL,
    "mode" "AiMode" NOT NULL DEFAULT 'ON_DEMAND',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_ai_settings_pkey" PRIMARY KEY ("planId")
);

-- CreateTable
CREATE TABLE "member_ai_consent" (
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agreed" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_ai_consent_pkey" PRIMARY KEY ("planId","userId")
);

-- CreateTable
CREATE TABLE "canvas_documents" (
    "planId" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_documents_pkey" PRIMARY KEY ("planId")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "plans_createdById_clientRequestId_key" ON "plans"("createdById", "clientRequestId");

-- CreateIndex
CREATE INDEX "plan_members_userId_idx" ON "plan_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "invite_links_tokenHash_key" ON "invite_links"("tokenHash");

-- CreateIndex
CREATE INDEX "invite_links_planId_idx" ON "invite_links"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "place_refs_provider_externalId_key" ON "place_refs"("provider", "externalId");

-- CreateIndex
CREATE INDEX "ideas_planId_archivedAt_idx" ON "ideas"("planId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ideas_planId_clientRequestId_key" ON "ideas"("planId", "clientRequestId");

-- CreateIndex
CREATE INDEX "idea_sources_ideaId_idx" ON "idea_sources"("ideaId");

-- CreateIndex
CREATE INDEX "idea_sources_planId_urlKey_idx" ON "idea_sources"("planId", "urlKey");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_versions_planId_version_key" ON "itinerary_versions"("planId", "version");

-- CreateIndex
CREATE INDEX "itinerary_stops_ideaId_idx" ON "itinerary_stops"("ideaId");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_stops_versionId_dayIndex_sequence_key" ON "itinerary_stops"("versionId", "dayIndex", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_stops_versionId_key_key" ON "itinerary_stops"("versionId", "key");

-- CreateIndex
CREATE INDEX "polls_planId_idx" ON "polls"("planId");

-- CreateIndex
CREATE INDEX "member_constraints_planId_idx" ON "member_constraints"("planId");

-- CreateIndex
CREATE INDEX "planning_jobs_planId_idx" ON "planning_jobs"("planId");

-- CreateIndex
CREATE INDEX "plan_proposals_planId_idx" ON "plan_proposals"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "comments_aiResponseId_key" ON "comments"("aiResponseId");

-- CreateIndex
CREATE INDEX "comments_ideaId_createdAt_idx" ON "comments"("ideaId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_responses_ideaId_createdAt_idx" ON "ai_responses"("ideaId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_interventions_commentId_idx" ON "ai_interventions"("commentId");

-- CreateIndex
CREATE INDEX "activity_events_planId_createdAt_idx" ON "activity_events"("planId", "createdAt");

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_members" ADD CONSTRAINT "plan_members_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_members" ADD CONSTRAINT "plan_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_placeRefId_fkey" FOREIGN KEY ("placeRefId") REFERENCES "place_refs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_sources" ADD CONSTRAINT "idea_sources_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_sources" ADD CONSTRAINT "idea_sources_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_reactions" ADD CONSTRAINT "idea_reactions_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_reactions" ADD CONSTRAINT "idea_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_versions" ADD CONSTRAINT "itinerary_versions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_versions" ADD CONSTRAINT "itinerary_versions_committedById_fkey" FOREIGN KEY ("committedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_versions" ADD CONSTRAINT "itinerary_versions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "plan_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_stops" ADD CONSTRAINT "itinerary_stops_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "itinerary_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_stops" ADD CONSTRAINT "itinerary_stops_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_constraints" ADD CONSTRAINT "member_constraints_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_constraints" ADD CONSTRAINT "member_constraints_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning_jobs" ADD CONSTRAINT "planning_jobs_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning_jobs" ADD CONSTRAINT "planning_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_proposals" ADD CONSTRAINT "plan_proposals_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_proposals" ADD CONSTRAINT "plan_proposals_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "planning_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_aiResponseId_fkey" FOREIGN KEY ("aiResponseId") REFERENCES "ai_responses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_responses" ADD CONSTRAINT "ai_responses_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_responses" ADD CONSTRAINT "ai_responses_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_responses" ADD CONSTRAINT "ai_responses_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_responses" ADD CONSTRAINT "ai_responses_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sources" ADD CONSTRAINT "ai_sources_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "ai_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interventions" ADD CONSTRAINT "ai_interventions_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interventions" ADD CONSTRAINT "ai_interventions_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "ai_responses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_ai_settings" ADD CONSTRAINT "plan_ai_settings_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_ai_settings" ADD CONSTRAINT "plan_ai_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_ai_consent" ADD CONSTRAINT "member_ai_consent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_ai_consent" ADD CONSTRAINT "member_ai_consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_documents" ADD CONSTRAINT "canvas_documents_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
