import type { Metadata, Viewport } from 'next';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

const ui = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });
const display = Fraunces({ subsets: ['latin'], variable: '--font-display-face', display: 'swap', axes: ['SOFT', 'opsz'] });

export const metadata: Metadata = {
  title: 'Orbit — plan together, go together',
  description: 'Collect ideas, decide together, and turn them into a plan you can actually follow.',
  applicationName: 'Orbit',
  // iPhone "Add to Home Screen": open full-screen with the name "Orbit".
  appleWebApp: { capable: true, title: 'Orbit', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#f8f6f2',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${display.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
