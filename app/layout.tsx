// FIX: Import React to provide the React namespace for types like React.ReactNode.
import React from "react";
import type { Metadata } from "next";
import { Share_Tech_Mono } from "next/font/google";
import "./globals.css";

const shareTechMono = Share_Tech_Mono({ 
  subsets: ["latin"],
  weight: "400",
  variable: '--font-share-tech-mono'
});

export const metadata: Metadata = {
  title: "Secret Burger",
  description: "Securely transmit 'secret recipes' (files) peer-to-peer with end-to-end encryption. No servers, no logs, just delicious secrets.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${shareTechMono.className} bg-gray-900 text-white antialiased`}>{children}</body>
    </html>
  );
}