import { describe, expect, it } from 'vitest';
import {
  can,
  createCommentInput,
  createInviteInput,
  inviteTokenFromHash,
  inviteUrl,
  parsePlanHint,
} from '../src';

describe('invite links', () => {
  const token = 'Ab3_-x'.repeat(5) + 'zz'; // 32 base64url characters

  it('put the token after #, so it never reaches a server log', () => {
    expect(inviteUrl('http://10.0.0.5:3000/', token)).toBe(`http://10.0.0.5:3000/join#${token}`);
    expect(inviteTokenFromHash(`#${token}`)).toBe(token);
  });

  it('reject anything that isn’t a token', () => {
    for (const hash of ['', '#', '#short', `#${token}&x=1`, `#${token.slice(0, 10)}<script>`, '#code=123456']) {
      expect(inviteTokenFromHash(hash)).toBeNull();
    }
  });

  it('can’t be made for the owner role, and expire on a fixed menu', () => {
    expect(createInviteInput.safeParse({ role: 'EDITOR', expiresIn: 'WEEK', maxUses: null }).success).toBe(true);
    expect(createInviteInput.safeParse({ role: 'OWNER', expiresIn: 'WEEK', maxUses: null }).success).toBe(false);
    expect(createInviteInput.safeParse({ role: 'VIEWER', expiresIn: 'YEAR', maxUses: null }).success).toBe(false);
    expect(createInviteInput.safeParse({ role: 'VIEWER', expiresIn: 'DAY', maxUses: 0 }).success).toBe(false);
  });

  it('follow the permission matrix', () => {
    expect(['OWNER', 'EDITOR', 'VIEWER'].map((r) => can(r as 'OWNER', 'invite.create'))).toEqual([true, true, false]);
    expect(['OWNER', 'EDITOR', 'VIEWER'].map((r) => can(r as 'OWNER', 'invite.manage'))).toEqual([true, false, false]);
    expect(['OWNER', 'EDITOR', 'VIEWER'].map((r) => can(r as 'OWNER', 'comment.create'))).toEqual([true, true, true]);
    expect(['OWNER', 'EDITOR', 'VIEWER'].map((r) => can(r as 'OWNER', 'comment.moderate'))).toEqual([true, false, false]);
  });
});

describe('comments', () => {
  it('are trimmed, non-empty and at most 1000 characters', () => {
    const id = 'req-12345678';
    expect(createCommentInput.parse({ clientRequestId: id, content: '  hi  ' }).content).toBe('hi');
    expect(createCommentInput.safeParse({ clientRequestId: id, content: ' \n ' }).success).toBe(false);
    expect(createCommentInput.safeParse({ clientRequestId: id, content: 'x'.repeat(1001) }).success).toBe(false);
    expect(createCommentInput.safeParse({ content: 'hi' }).success).toBe(false);
  });
});

describe('live hints', () => {
  it('keep only known topics and safe ids', () => {
    expect(parsePlanHint('{"type":"changed","topics":["comments","nope","ideas"],"ideaId":"abc_123"}')).toEqual({
      type: 'changed',
      topics: ['ideas', 'comments'],
      ideaId: 'abc_123',
    });
    expect(parsePlanHint('{"type":"changed","topics":["plan"],"ideaId":"<img>","by":"u1"}')).toEqual({ type: 'changed', topics: ['plan'], by: 'u1' });
  });

  it('drop anything malformed', () => {
    for (const raw of ['', 'not json', 'null', '[]', '{"type":"changed"}', '{"type":"changed","topics":[]}', '{"type":"other","topics":["plan"]}', '{"type":"changed","topics":["x"]}', JSON.stringify({ type: 'changed', topics: ['plan'], pad: 'x'.repeat(600) })]) {
      expect(parsePlanHint(raw)).toBeNull();
    }
  });
});
