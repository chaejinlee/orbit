'use client';

import { useParams } from 'next/navigation';
import { HybridEntry } from '@/components/hybrid-entry';
import { RequireSession } from '@/components/shell';

export default function StartPage() {
  const { planId } = useParams<{ planId: string }>();
  return (
    <RequireSession>
      <HybridEntry planId={planId} />
    </RequireSession>
  );
}
