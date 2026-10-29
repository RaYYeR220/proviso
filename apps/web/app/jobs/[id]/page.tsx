import { JobView } from "@/components/JobView";
import "../../app.css";

export default async function Job({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ recorded?: string }> }) {
  const { id } = await params;
  const { recorded } = await searchParams;
  return (
    <main className="wrap page">
      <JobView id={id} recorded={recorded === "1"} />
    </main>
  );
}
