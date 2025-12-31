import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recipe Lanes",
  description: "Visual Recipe Editor",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet" crossOrigin="anonymous" />
      </head>
      <body
        className={`antialiased bg-zinc-900 text-white`}
      >
        {process.env.NEXT_PUBLIC_ENV_NAME === 'staging' && (
          <div className="bg-orange-600 text-white text-xs font-bold text-center py-1 fixed top-0 left-0 right-0 z-[100]">
            STAGING ENVIRONMENT
          </div>
        )}
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}