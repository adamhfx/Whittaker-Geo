import type { Metadata } from "next";
import "./brand.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whittaker Geo",
  description:
    "Explore project economics with Whittaker Geo. Compare subscription plans for private saved scenarios, calculation history, and editable Excel results.",
  icons: {
    icon: [{ url: "/whittaker-geo-icon.svg", type: "image/svg+xml" }],
    shortcut: "/whittaker-geo-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
