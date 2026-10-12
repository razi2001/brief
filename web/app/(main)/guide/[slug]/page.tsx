import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LESSON_SLUGS, lessonBySlug } from "@/lib/guide/lessons";
import LessonView from "@/components/guide/LessonView";

// Every lesson is built ahead: switching lessons fetches nothing.
export const dynamicParams = false;
export function generateStaticParams() {
  return LESSON_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const lesson = lessonBySlug(slug);
  return { title: lesson ? `${lesson.title} · Guide` : "Guide · Brief Cloud" };
}

export default async function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!lessonBySlug(slug)) notFound();
  return <LessonView slug={slug} />;
}
