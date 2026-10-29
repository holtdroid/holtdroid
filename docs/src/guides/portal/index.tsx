import { LockIcon } from "lucide-react"
import type { PortalState } from "../types"
import { LaunchDialog, UploadDialog } from "./dialogs"
import { Header, Home } from "./home"
import { Toast } from "./overlays"
import { Computers, Recording, RecordingHeader, RecordingsList } from "./pages"
import { Session, SessionHeader } from "./session"

const urls: Record<PortalState["page"], string> = {
  home: "/",
  session: "/session/emulator/7f3a9c",
  recordings: "/recordings",
  recording: "/recordings/rec-42",
  computers: "/computers",
}

function Page({ s }: { s: PortalState }) {
  switch (s.page) {
    case "session":
      return <Session s={s} />
    case "recordings":
      return <RecordingsList s={s} />
    case "recording":
      return <Recording s={s} />
    case "computers":
      return <Computers s={s} />
    default:
      return <Home s={s} />
  }
}

function Toasts({ s }: { s: PortalState }) {
  switch (s.toast) {
    case "crash":
      return (
        <Toast kind="error" title="The app crashed" action="Logcat">
          <pre className="font-mono text-[11px] whitespace-pre-wrap">
            {
              "FATAL EXCEPTION: main\njava.lang.IllegalStateException: Cart is empty\n  at …CartViewModel.checkout(CartViewModel.kt:88)"
            }
          </pre>
        </Toast>
      )
    case "uploaded":
      return (
        <Toast kind="success" title="Uploaded">
          Pinecone Shop
        </Toast>
      )
    case "saved":
      return (
        <Toast kind="success" title="App data saved">
          Pick it when you launch this app again.
        </Toast>
      )
    case "bundle":
      return (
        <Toast kind="success" title="Bug report ready">
          pinecone-bugreport-2026-10-29-1204.zip
        </Toast>
      )
    case "link":
      return <Toast title="Link copied">Anyone signed in can open this session with it</Toast>
    case "installing":
      return <Toast title={`Installing ${s.version}`}>{s.keepData ? "Keeping the app's data" : "Clean install"}</Toast>
    case "installed":
      return <Toast kind="success" title={`Now running ${s.version}`} />
    case "rec-link":
      return <Toast title="Link copied">Anyone with the link can watch this recording</Toast>
    default:
      return null
  }
}

export function Portal({ s }: { s: PortalState }) {
  const slotted = s.page === "session" || s.page === "recording"
  return (
    <div className="bg-background text-foreground flex size-full flex-col overflow-hidden rounded-xl border shadow-sm">
      <div className="bg-muted/60 flex h-9 shrink-0 items-center gap-3 border-b px-3">
        <span className="flex gap-1.5">
          <span className="size-3 rounded-full bg-red-400/80" />
          <span className="size-3 rounded-full bg-amber-400/80" />
          <span className="size-3 rounded-full bg-emerald-400/80" />
        </span>
        <span className="bg-background text-muted-foreground mx-auto flex h-6 w-[420px] items-center gap-1.5 rounded-md px-2.5 font-mono text-xs">
          <LockIcon className="size-3" />
          holtdroid.example.com{urls[s.page]}
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Header s={s}>
          {slotted ? s.page === "session" ? <SessionHeader s={s} /> : <RecordingHeader /> : undefined}
        </Header>
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Page s={s} />
        </main>
        {s.dialog === "launch" && <LaunchDialog s={s} />}
        {s.dialog === "upload" && <UploadDialog s={s} />}
        <Toasts s={s} />
      </div>
    </div>
  )
}
