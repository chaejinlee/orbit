'use client';

import { Suspense } from 'react';
import { CreatePlan } from '@/components/create-plan';
import { RequireSession } from '@/components/shell';

export default function NewPlanPage() {
  return (
    <RequireSession>
      <Suspense>
        <CreatePlan />
      </Suspense>
    </RequireSession>
  );
}
