'use client';

import { Home } from '@/components/home';
import { RequireSession } from '@/components/shell';

export default function HomePage() {
  return (
    <RequireSession>
      <Home />
    </RequireSession>
  );
}
