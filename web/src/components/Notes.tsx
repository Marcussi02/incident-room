import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, List, ListOrdered } from "lucide-react";
import { useEffect, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { wsUrl } from "../lib/live";
import { useUser, type LocalUser } from "../lib/user";
import { Avatar, Card, LiveDot } from "./ui";

interface Peer {
  clientId: number;
  user: LocalUser;
}

function Toolbar({ editor }: { editor: Editor }) {
  const items = [
    { icon: Heading2, label: "Heading", active: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: Bold, label: "Bold", active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { icon: List, label: "Bullet list", active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { icon: ListOrdered, label: "Numbered list", active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
  ];
  return (
    <div className="flex gap-1">
      {items.map(({ icon: Icon, label, active, run }) => (
        <button
          key={label}
          type="button"
          onClick={run}
          aria-label={label}
          aria-pressed={active}
          className={`rounded-md p-1.5 ${active ? "bg-zinc-700 text-zinc-50" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"}`}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}

function CollaborativeEditor({ doc, provider, user }: { doc: Y.Doc; provider: WebsocketProvider; user: LocalUser }) {
  // The provider may already be connected by the time this mounts.
  const [status, setStatus] = useState<"connecting" | "live" | "offline">(provider.wsconnected ? "live" : "connecting");
  const [peers, setPeers] = useState<Peer[]>([]);

  const editor = useEditor(
    {
      extensions: [
        // Yjs keeps the history, so ProseMirror's own undo stack must be off.
        StarterKit.configure({ history: false }),
        Placeholder.configure({
          placeholder: "Working notes: hypotheses, what you've checked, who's doing what… Everyone here sees edits live.",
        }),
        Collaboration.configure({ document: doc }),
        CollaborationCursor.configure({ provider, user }),
      ],
    },
    [doc, provider],
  );

  // Keep the name/colour on our cursor in sync if the user renames themselves.
  useEffect(() => {
    provider.awareness.setLocalStateField("user", user);
  }, [provider, user]);

  useEffect(() => {
    const onStatus = ({ status: s }: { status: string }) => setStatus(s === "connected" ? "live" : s === "connecting" ? "connecting" : "offline");
    const onAwareness = () => {
      const list: Peer[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (state.user) list.push({ clientId, user: state.user as LocalUser });
      });
      setPeers(list);
    };
    provider.on("status", onStatus);
    provider.awareness.on("change", onAwareness);
    onAwareness();
    setStatus(provider.wsconnected ? "live" : "connecting");
    return () => {
      provider.off("status", onStatus);
      provider.awareness.off("change", onAwareness);
    };
  }, [provider]);

  return (
    <Card
      title={
        <span className="flex items-center gap-3">
          Shared notes <LiveDot status={status} />
        </span>
      }
      action={
        <div className="flex items-center gap-3">
          {editor && <Toolbar editor={editor} />}
          <div className="flex -space-x-2" aria-label={`${peers.length} people here`}>
            {peers.slice(0, 5).map((p) => (
              <Avatar key={p.clientId} name={p.user.name} color={p.user.color} size={26} />
            ))}
            {peers.length > 5 && <span className="pl-3 text-xs text-zinc-400">+{peers.length - 5}</span>}
          </div>
        </div>
      }
      className="notes"
    >
      <div className="px-5 py-4">
        <EditorContent editor={editor} />
      </div>
    </Card>
  );
}

/** Live, multi-cursor notes. Each incident is its own Yjs document, synced over WebSocket and saved server-side. */
export function Notes({ incidentId }: { incidentId: string }) {
  const user = useUser();
  const [session, setSession] = useState<{ doc: Y.Doc; provider: WebsocketProvider } | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(wsUrl("/yjs"), incidentId, doc);
    setSession({ doc, provider });
    return () => {
      provider.destroy();
      doc.destroy();
    };
  }, [incidentId]);

  if (!session || !user) return <Card title="Shared notes"><div className="h-[360px]" /></Card>;
  return <CollaborativeEditor doc={session.doc} provider={session.provider} user={user} />;
}
