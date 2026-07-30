import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const metadataBase = host
    ? new URL(`${protocol}://${host}`)
    : new URL("http://localhost:3000");
  const description =
    "Turn group-project promises into clear, voluntary tasks. Ship your work, or chip into the communal dinner fund.";

  return {
    metadataBase,
    title: "Ship or Chip In — Team accountability with better dinner",
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Ship or Chip In",
      description,
      type: "website",
      images: [{ url: "/og.png", width: 1731, height: 909 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Ship or Chip In",
      description,
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <template
          dangerouslySetInnerHTML={{
            __html: `<!--
THESIS: A studio proof rail makes every task feel ready for a clear sign-off; it refuses generic blue SaaS chrome and punitive game-board visuals.
OWN-WORLD: Limestone canvas, paper surfaces, carbon controls, acid-lime action states, coral pig; dense workhorse type, precise rules, soft depth, and decisive 10-18px corners.
STORY: A teammate immediately sees what needs action, what proof exists, what contribution was authorized, and how the shared pot changes.
FIRST VIEWPORT: A carbon top rail, 40px task heading and actions, a compact workflow strip, proof-like task rows on the left, and a dark piggy-bank instrument on the right.
FORM: Studio Proof Rail, grounded direction 5 of 7, seed 3a615184.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
