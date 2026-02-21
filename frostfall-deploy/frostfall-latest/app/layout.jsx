// app/layout.jsx
import "./themes.css";
import { Cinzel, Inter } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--displayFont",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--uiFont",
});

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${cinzel.variable} ${inter.variable}`}>
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
