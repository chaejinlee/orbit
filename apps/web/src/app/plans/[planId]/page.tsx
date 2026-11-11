'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { RequireSession } from '@/components/shell';
import { Workspace } from '@/components/workspace/workspace';

export default function PlanPage() {
  const { planId } = useParams<{ planId: string }>();
  return (
    <RequireSession>
      <Suspense>
        <Workspace planId={planId} />
      </Suspense>
    </RequireSession>
  );
}
