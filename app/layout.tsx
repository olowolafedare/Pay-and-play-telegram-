import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
export const metadata: Metadata = { title: "Pay and Play", description: "Play, earn rewards points and compete with friends." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#090d18" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
 return <html lang="en"><body><Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" /><Script src="https://libtl.com/sdk.js" data-zone="12342383" data-sdk="show_12342383" strategy="afterInteractive" />{children}</body></html>;
}
