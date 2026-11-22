import type { Metadata } from "next";
import { SessionRoom } from "./SessionRoom";

export const metadata: Metadata = { title: "Séance · Pod Stud" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ hote?: string }>;
}) {
  const { id } = await params;
  const { hote } = await searchParams;
  return <SessionRoom sessionId={id} host={hote === "1"} />;
}
