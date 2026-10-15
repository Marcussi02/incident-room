import { Activity } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { setUserName, useUser } from "../lib/user";
import { Avatar, Button, inputClass, Modal } from "./ui";

function NameDialog({ onClose }: { onClose?: () => void }) {
  const user = useUser();
  const [name, setName] = useState(user?.name ?? "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setUserName(name);
    onClose?.();
  };
  return (
    <Modal title={user ? "Change your name" : "Welcome to IncidentRoom"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-zinc-400">
          Your name appears on your cursor in shared notes and on timeline entries you add.
        </p>
        <input
          autoFocus
          className={inputClass}
          placeholder="e.g. Priya Shah"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          aria-label="Your name"
        />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Continue
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const user = useUser();
  const [editing, setEditing] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400">
              <Activity size={16} />
            </span>
            IncidentRoom
          </Link>
          {user && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              <Avatar name={user.name} color={user.color} size={24} />
              <span className="hidden sm:inline">{user.name}</span>
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      {(!user || editing) && <NameDialog onClose={user ? () => setEditing(false) : undefined} />}
    </div>
  );
}
