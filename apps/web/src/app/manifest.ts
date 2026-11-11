import type { MetadataRoute } from 'next';

/** Lets a phone add Orbit to its home screen and open it full-screen, like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Orbit — plan together, go together',
    short_name: 'Orbit',
    description: 'Collect ideas, decide together, and turn them into a plan you can actually follow.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f8f6f2',
    theme_color: '#f8f6f2',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
