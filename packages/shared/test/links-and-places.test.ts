import { describe, expect, it } from 'vitest';
import {
  findDuplicatePlaces,
  InvalidLinkError,
  nameSimilarity,
  normalizeLink,
  normalizePlaceName,
  parseMapsLink,
} from '../src';

describe('normalizeLink', () => {
  it('strips tracking params, fragments and credentials', () => {
    const link = normalizeLink('https://user:pw@www.example.com/menu/?utm_source=ig&fbclid=1&table=2#top');
    expect(link.url).toBe('https://www.example.com/menu/?table=2');
    expect(link.key).toBe('example.com/menu?table=2');
    expect(link.platform).toBe('web');
  });

  it('adds https to bare domains', () => {
    expect(normalizeLink('instagram.com/reel/Cx1').url).toBe('https://instagram.com/reel/Cx1');
  });

  it('gives the same key to the same post shared in different shapes', () => {
    const a = normalizeLink('https://www.instagram.com/reel/Cx1AbC/?igsh=abc');
    const b = normalizeLink('https://instagram.com/p/Cx1AbC');
    expect(a.key).toBe(b.key);
    expect(a.platform).toBe('instagram');

    const y1 = normalizeLink('https://youtu.be/dQw4w9WgXcQ?si=x');
    const y2 = normalizeLink('https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share');
    expect(y1.key).toBe('youtube.com/watch?v=dQw4w9WgXcQ');
    expect(y2.key).toBe('youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('keeps case in paths (short codes are case-sensitive)', () => {
    expect(normalizeLink('https://instagram.com/p/AbC').key).not.toBe(normalizeLink('https://instagram.com/p/abc').key);
  });

  it('rejects things that are not web links', () => {
    expect(() => normalizeLink('javascript:alert(1)')).toThrow(InvalidLinkError);
    expect(() => normalizeLink('file:///etc/passwd')).toThrow(InvalidLinkError);
    expect(() => normalizeLink('hello')).toThrow(InvalidLinkError);
    expect(() => normalizeLink('   ')).toThrow(InvalidLinkError);
  });

  it('detects map platforms used in Korea', () => {
    expect(normalizeLink('https://naver.me/abc').platform).toBe('naver_map');
    expect(normalizeLink('https://place.map.kakao.com/123').platform).toBe('kakao_map');
  });
});

describe('parseMapsLink', () => {
  it('reads the pinned place from a Google Maps place URL', () => {
    const place = parseMapsLink(
      'https://www.google.com/maps/place/Pai+Northern+Thai/@43.6477,-79.3888,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d43.6478!4d-79.3886',
    );
    expect(place).toEqual({ provider: 'google', name: 'Pai Northern Thai', lat: 43.6478, lng: -79.3886 });
  });

  it('reads Maps URLs API links with a place id', () => {
    const place = parseMapsLink(
      'https://www.google.com/maps/search/?api=1&query=Ramen%20Isshin&query_place_id=ChIJabc',
    );
    expect(place).toEqual({ provider: 'google', name: 'Ramen Isshin', providerPlaceId: 'ChIJabc' });
  });

  it('works on country Google domains and decodes non-Latin names', () => {
    const place = parseMapsLink('https://www.google.co.kr/maps/place/%EC%B9%B4%ED%8E%98+%EC%98%A8%EB%8F%84/@37.5,127.0,15z');
    expect(place?.name).toBe('카페 온도');
    expect(place?.lat).toBe(37.5);
  });

  it('reads Apple Maps links', () => {
    expect(parseMapsLink('https://maps.apple.com/?q=Blue+Bottle&ll=37.78,-122.41')).toEqual({
      provider: 'apple',
      name: 'Blue Bottle',
      lat: 37.78,
      lng: -122.41,
    });
  });

  it('returns null for short links (they need a redirect lookup)', () => {
    expect(parseMapsLink('https://maps.app.goo.gl/AbCdEf')).toBeNull();
  });
});

describe('place duplicates', () => {
  it('normalizes accents, case, spacing and punctuation but keeps Hangul intact', () => {
    expect(normalizePlaceName('Café  Olé!')).toBe('cafeole');
    expect(normalizePlaceName('스타벅스 강남점')).toBe('스타벅스강남점');
  });

  it('scores name similarity', () => {
    expect(nameSimilarity('Blue Bottle Coffee', 'blue bottle coffee')).toBe(1);
    expect(nameSimilarity('Blue Bottle', 'Blue Bottle Coffee Shibuya')).toBeGreaterThanOrEqual(0.85);
    expect(nameSimilarity('Pai Northern Thai', 'Kinka Izakaya')).toBeLessThan(0.3);
  });

  const existing = [
    { id: 'a', name: 'Pai Northern Thai Kitchen', lat: 43.6478, lng: -79.3886 },
    { id: 'b', name: 'Kinka Izakaya', lat: 43.66, lng: -79.38 },
    { id: 'c', name: 'Sushi Masaki Saito' },
  ];

  it('flags a nearby place with a similar name as a high-confidence duplicate', () => {
    const matches = findDuplicatePlaces({ name: 'Pai', lat: 43.6479, lng: -79.3885 }, existing);
    expect(matches[0]).toMatchObject({ id: 'a', confidence: 'high' });
  });

  it('only asks (medium) when coordinates are missing', () => {
    const matches = findDuplicatePlaces({ name: 'sushi masaki saito' }, existing);
    expect(matches).toEqual([expect.objectContaining({ id: 'c', confidence: 'medium', reasons: ['same_name'] })]);
  });

  it('does not match the same name far away (another branch)', () => {
    expect(findDuplicatePlaces({ name: 'Kinka Izakaya', lat: 43.0, lng: -79.0 }, existing)).toEqual([]);
  });

  it('matches by provider id regardless of name', () => {
    const matches = findDuplicatePlaces(
      { name: 'whatever', provider: 'GOOGLE', externalId: 'ChIJ1' },
      [{ id: 'z', name: 'Other', provider: 'GOOGLE', externalId: 'ChIJ1' }],
    );
    expect(matches[0]).toMatchObject({ id: 'z', confidence: 'high', reasons: ['same_provider_id'] });
  });
});
