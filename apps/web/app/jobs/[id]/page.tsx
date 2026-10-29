import { JobView } from "@/components/JobView";
import "../../app.css";

export default async function Job({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="wrap page">
      <JobView id={id} />
    </main>
  );
}
