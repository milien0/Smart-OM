"use client";

import React from "react";

export default function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	// Layout a schermo intero: la sidebar è stata rimossa, il contenuto
	// della sede occupa l'intera finestra.
	return (
		<div className='flex h-screen overflow-hidden bg-white text-[#1f1f1f] antialiased font-sans'>
			<main className='flex-1 flex flex-col overflow-hidden'>{children}</main>
		</div>
	);
}
