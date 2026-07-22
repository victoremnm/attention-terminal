import { AttentionChat } from "@/components/AttentionChat";
import { SurfaceNav } from "@/components/SurfaceNav";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <SurfaceNav active="chat" />
        </div>
        <AttentionChat />
      </div>
    </main>
  );
}
