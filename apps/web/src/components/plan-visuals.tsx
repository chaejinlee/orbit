import type { IdeaKind, PlanStatus, PlanType } from '@orbit/shared';
import { Heart, Link2, MapPin, PartyPopper, Plane, StickyNote, Ticket, Users, type LucideIcon } from 'lucide-react';
import type { Tone } from './ui';

export const PLAN_TYPE_STYLE: Record<PlanType, { icon: LucideIcon; label: string; blurb: string; band: string; tile: string; iconCls: string }> = {
  DATE: {
    icon: Heart,
    label: 'Date',
    blurb: 'A few hours for two',
    band: 'from-lilac-100 via-lilac-50 to-peach-50',
    tile: 'hover:border-lilac-600 bg-lilac-50',
    iconCls: 'bg-lilac text-ink',
  },
  HANGOUT: {
    icon: Users,
    label: 'Hangout',
    blurb: 'Friends, food, fun',
    band: 'from-peach-50 via-butter-50 to-peach/50',
    tile: 'hover:border-peach-700 bg-peach-50',
    iconCls: 'bg-peach text-ink',
  },
  TRIP: {
    icon: Plane,
    label: 'Trip',
    blurb: 'Days away, together',
    band: 'from-sky-50 via-sage-50 to-sky/50',
    tile: 'hover:border-sky-700 bg-sky-50',
    iconCls: 'bg-sky text-ink',
  },
  EVENT: {
    icon: PartyPopper,
    label: 'Event',
    blurb: 'Birthdays & occasions',
    band: 'from-sage-50 via-butter-50 to-sage/50',
    tile: 'hover:border-sage-700 bg-sage-50',
    iconCls: 'bg-sage text-ink',
  },
};

export const PLAN_STATUS_STYLE: Record<PlanStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Just started', tone: 'neutral' },
  PLANNING: { label: 'Planning', tone: 'lilac' },
  CONFIRMED: { label: 'Confirmed', tone: 'sage' },
  COMPLETED: { label: 'Done', tone: 'neutral' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
};

export const IDEA_KIND_STYLE: Record<IdeaKind, { icon: LucideIcon; label: string; band: string; chip: string; mark: string }> = {
  PLACE: { icon: MapPin, label: 'Place', band: 'from-sage-50 to-sage/70', chip: 'text-sage-700', mark: 'text-sage-700/15' },
  LINK: { icon: Link2, label: 'Link', band: 'from-sky-50 to-sky/70', chip: 'text-sky-700', mark: 'text-sky-700/15' },
  NOTE: { icon: StickyNote, label: 'Note', band: 'from-butter-50 to-butter/80', chip: 'text-butter-800', mark: 'text-butter-800/15' },
  ACTIVITY: { icon: Ticket, label: 'Activity', band: 'from-peach-50 to-peach/80', chip: 'text-peach-700', mark: 'text-peach-700/15' },
};
