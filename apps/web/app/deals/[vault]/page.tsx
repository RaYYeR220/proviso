import { DealView } from "@/components/DealView";
import "../../app.css";

export default async function Deal({ params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  return (
    <main className="wrap page">
      <DealView vault={vault} />
    </main>
  );
}
