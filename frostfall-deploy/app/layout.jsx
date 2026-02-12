import { Analytics } from '@vercel/analytics/next';

export const metadata = {
  title: "Frostfall Realms — Worldbuilding Engine",
  description: "A dark fantasy worldbuilding platform for writers, game masters, and world creators.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet" />
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { background: #0a0e1a; overflow: hidden; }
          ::-webkit-scrollbar { width: 8px; height: 8px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: #1e2a3a; border-radius: 4px; }
          ::-webkit-scrollbar-thumb:hover { background: #2a3a4e; }
        `}</style>
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
