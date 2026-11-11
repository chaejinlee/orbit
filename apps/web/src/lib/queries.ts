'use client';

import type {
  AiAnswerDTO,
  AskInput,
  CommentDTO,
  CreateInviteInput,
  HintTopic,
  IdeaDTO,
  InviteDTO,
  InviteRole,
  PhotoDTO,
  ReactionKind,
  UpdateIdeaInput,
  UpdatePlanInput,
} from '@orbit/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { notifyPlan } from './plan-hints';

export const keys = {
  plans: ['plans'] as const,
  plan: (id: string) => ['plan', id] as const,
  ideas: (id: string) => ['ideas', id] as const,
  itinerary: (id: string) => ['itinerary', id] as const,
  aiStatus: ['ai-status'] as const,
  answers: (planId: string, ideaId: string) => ['answers', planId, ideaId] as const,
  invites: (planId: string) => ['invites', planId] as const,
  comments: (planId: string, ideaId: string) => ['comments', planId, ideaId] as const,
  photos: (planId: string) => ['photos', planId] as const,
};

export function usePlans(enabled = true) {
  return useQuery({ queryKey: keys.plans, queryFn: api.plans, enabled });
}

export function usePlan(planId: string) {
  return useQuery({ queryKey: keys.plan(planId), queryFn: () => api.plan(planId) });
}

export function useIdeas(planId: string) {
  return useQuery({ queryKey: keys.ideas(planId), queryFn: () => api.ideas(planId) });
}

export function useItinerary(planId: string) {
  return useQuery({ queryKey: keys.itinerary(planId), queryFn: () => api.itinerary(planId) });
}

export function useUpdatePlan(planId: string) {
  const qc = useQueryClient();
  const notify = (topics: HintTopic[], ideaId?: string) => notifyPlan(planId, topics, ideaId);
  return useMutation({
    mutationFn: (patch: UpdatePlanInput) => api.updatePlan(planId, patch),
    onSuccess: (plan) => {
      qc.setQueryData(keys.plan(planId), plan);
      void qc.invalidateQueries({ queryKey: keys.plans });
      notify(['plan']);
    },
  });
}

function replaceIdea(qc: ReturnType<typeof useQueryClient>, planId: string, idea: IdeaDTO) {
  qc.setQueryData<IdeaDTO[]>(keys.ideas(planId), (list) =>
    list ? (list.some((i) => i.id === idea.id) ? list.map((i) => (i.id === idea.id ? idea : i)) : [...list, idea]) : [idea],
  );
}

export function useIdeaMutations(planId: string) {
  const qc = useQueryClient();
  const notify = (topics: HintTopic[], ideaId?: string) => notifyPlan(planId, topics, ideaId);
  const onSuccess = (idea: IdeaDTO) => {
    replaceIdea(qc, planId, idea);
    notify(['ideas']);
  };
  return {
    update: useMutation({
      mutationFn: ({ ideaId, patch }: { ideaId: string; patch: UpdateIdeaInput }) => api.updateIdea(planId, ideaId, patch),
      onSuccess,
    }),
    archive: useMutation({
      mutationFn: ({ ideaId, archived }: { ideaId: string; archived: boolean }) => api.archiveIdea(planId, ideaId, archived),
      onSuccess,
    }),
    react: useMutation({
      mutationFn: ({ ideaId, kind }: { ideaId: string; kind: ReactionKind | null }) => api.reactToIdea(planId, ideaId, kind),
      onSuccess,
    }),
    upsertLocal: onSuccess,
  };
}

export function useAiStatus() {
  return useQuery({ queryKey: keys.aiStatus, queryFn: api.aiStatus, staleTime: 60_000 });
}

/** Answers on one card: shared ones plus my private ones. Polls gently so shares from others show up. */
export function useAnswers(planId: string, ideaId: string) {
  return useQuery({
    queryKey: keys.answers(planId, ideaId),
    queryFn: () => api.answers(planId, ideaId),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useAnswerMutations(planId: string, ideaId: string) {
  const qc = useQueryClient();
  const notify = (topics: HintTopic[], ideaId?: string) => notifyPlan(planId, topics, ideaId);
  const key = keys.answers(planId, ideaId);
  const upsert = (answer: AiAnswerDTO) =>
    qc.setQueryData<AiAnswerDTO[]>(key, (list = []) =>
      list.some((a) => a.id === answer.id) ? list.map((a) => (a.id === answer.id ? answer : a)) : [answer, ...list],
    );
  return {
    ask: useMutation({
      mutationFn: (input: AskInput) => api.askOrbit(planId, ideaId, input),
      onSuccess: (answer) => {
        upsert(answer);
        void qc.invalidateQueries({ queryKey: keys.aiStatus });
      },
    }),
    share: useMutation({
      mutationFn: (answerId: string) => api.shareAnswer(planId, answerId),
      onSuccess: (answer) => {
        upsert(answer);
        notify(['answers'], ideaId);
      },
    }),
    hide: useMutation({
      mutationFn: (answerId: string) => api.hideAnswer(planId, answerId),
      onSuccess: (_, answerId) => {
        qc.setQueryData<AiAnswerDTO[]>(key, (list = []) => list.filter((a) => a.id !== answerId));
        notify(['answers'], ideaId);
      },
    }),
  };
}

// ─── Sharing ────────────────────────────────────────────────────────────────

export function useInvites(planId: string, enabled: boolean) {
  return useQuery({ queryKey: keys.invites(planId), queryFn: () => api.invites(planId), enabled });
}

export function useInviteMutations(planId: string) {
  const qc = useQueryClient();
  const notify = (topics: HintTopic[], ideaId?: string) => notifyPlan(planId, topics, ideaId);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.invites(planId) });
    notify(['plan']);
  };
  return {
    create: useMutation({
      mutationFn: (input: CreateInviteInput) => api.createInvite(planId, input),
      onSuccess: ({ invite }) => {
        qc.setQueryData<InviteDTO[]>(keys.invites(planId), (list = []) => [invite, ...list.filter((i) => i.id !== invite.id)]);
        refresh();
      },
    }),
    revoke: useMutation({
      mutationFn: (inviteId: string) => api.revokeInvite(planId, inviteId),
      onSuccess: (_, inviteId) => {
        qc.setQueryData<InviteDTO[]>(keys.invites(planId), (list = []) => list.filter((i) => i.id !== inviteId));
        refresh();
      },
    }),
  };
}

export function useMemberMutations(planId: string) {
  const qc = useQueryClient();
  const notify = (topics: HintTopic[], ideaId?: string) => notifyPlan(planId, topics, ideaId);
  return {
    changeRole: useMutation({
      mutationFn: ({ userId, role }: { userId: string; role: InviteRole }) => api.changeMemberRole(planId, userId, role),
      onSuccess: (plan) => {
        qc.setQueryData(keys.plan(planId), plan);
        void qc.invalidateQueries({ queryKey: keys.invites(planId) });
        notify(['plan']);
      },
    }),
    remove: useMutation({
      mutationFn: (userId: string) => api.removeMember(planId, userId),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: keys.plan(planId) });
        void qc.invalidateQueries({ queryKey: keys.invites(planId) });
        void qc.invalidateQueries({ queryKey: keys.ideas(planId) });
        notify(['plan', 'ideas']);
      },
    }),
    leave: useMutation({
      mutationFn: () => api.leavePlan(planId),
      onSuccess: () => {
        notify(['plan', 'ideas']);
        void qc.invalidateQueries({ queryKey: keys.plans });
      },
    }),
  };
}

// ─── Comments ───────────────────────────────────────────────────────────────

/** Live through hints from other screens; the slow poll is only a safety net. */
export function useComments(planId: string, ideaId: string) {
  return useQuery({
    queryKey: keys.comments(planId, ideaId),
    queryFn: () => api.comments(planId, ideaId),
    staleTime: 10_000,
    refetchInterval: 60_000,
  });
}

export function useCommentMutations(planId: string, ideaId: string) {
  const qc = useQueryClient();
  const notify = (topics: HintTopic[], ideaId?: string) => notifyPlan(planId, topics, ideaId);
  const key = keys.comments(planId, ideaId);
  const setCount = (count: (current: number) => number) =>
    qc.setQueryData<IdeaDTO[]>(keys.ideas(planId), (list) =>
      list?.map((i) => (i.id === ideaId ? { ...i, commentCount: Math.max(0, count(i.commentCount)) } : i)),
    );
  const changed = () => notify(['comments', 'ideas'], ideaId);
  return {
    create: useMutation({
      mutationFn: (input: { clientRequestId: string; content: string }) => api.createComment(planId, ideaId, input),
      onSuccess: (comment) => {
        let added = false;
        qc.setQueryData<CommentDTO[]>(key, (list = []) => {
          if (list.some((c) => c.id === comment.id)) return list;
          added = true;
          return [...list, comment];
        });
        if (added) setCount((n) => n + 1);
        changed();
      },
    }),
    update: useMutation({
      mutationFn: ({ commentId, content }: { commentId: string; content: string }) => api.updateComment(planId, commentId, content),
      onSuccess: (comment) => {
        qc.setQueryData<CommentDTO[]>(key, (list = []) => list.map((c) => (c.id === comment.id ? comment : c)));
        notify(['comments'], ideaId);
      },
    }),
    remove: useMutation({
      mutationFn: (commentId: string) => api.deleteComment(planId, commentId),
      onSuccess: (_, commentId) => {
        let removed = false;
        qc.setQueryData<CommentDTO[]>(key, (list = []) => {
          removed = list.some((c) => c.id === commentId);
          return list.filter((c) => c.id !== commentId);
        });
        if (removed) setCount((n) => n - 1);
        changed();
      },
    }),
  };
}

/**
 * The plan's photos with their signed links. Links work for at least an hour,
 * so the list refreshes well before that.
 */
export function usePhotos(planId: string) {
  return useQuery({
    queryKey: keys.photos(planId),
    queryFn: () => api.photos(planId),
    staleTime: 20 * 60_000,
    refetchInterval: 40 * 60_000,
  });
}

export function useRememberPhoto(planId: string) {
  const qc = useQueryClient();
  return (photo: PhotoDTO) =>
    qc.setQueryData<PhotoDTO[]>(keys.photos(planId), (old) => [...(old ?? []).filter((p) => p.id !== photo.id), photo]);
}
