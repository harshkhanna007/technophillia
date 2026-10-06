import type { Metadata, Viewport } from 'next';
import { Geist, Unbounded } from 'next/font/google';
import './globals.css';

const display = Unbounded({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['300', '400'],
  display: 'swap',
});

const sans = Geist({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Technophilia | Grow the Tree',
  description:
    'An interactive digital ecosystem. Activate the seed and grow six independent technological organisms: AI, robotics, sustainability, innovation, future skills and beyond.',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // Browser extensions (fonts/shopping/translate tools) often inject attributes into <html>/<body>
    // before React hydrates; that is harmless here, so don't let it raise a hydration error.
    <html lang="en" className={`${display.variable} ${sans.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
