import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
	weight: ["100", "200", "300", "400", "500", "700", "800", "900"],
	subsets: ["latin"],
	variable: "--font-inter",
});
export const metadata: Metadata = {
	title: "Smart O&M",
	description: "",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			lang='it'
			className={`${inter.variable} ${inter.className} h-full antialiased`}
		>
			<body className='min-h-full flex flex-col'>{children}</body>
		</html>
	);
}
