import { APP_DISPLAY_NAME } from "../../branding";
import { Button } from "../ui/button";

export function PairingPendingSurface() {
  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground">
      Connecting to the local backend…
    </div>
  );
}

export function PairingRouteSurface({ initialErrorMessage }: { initialErrorMessage?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <section className="max-w-lg space-y-4">
        <p className="text-sm text-muted-foreground">{APP_DISPLAY_NAME}</p>
        <h1 className="text-xl font-semibold">The local backend is unavailable</h1>
        <p>
          {initialErrorMessage || "Restart the desktop app to reconnect to your local workspace."}
        </p>
        <Button onClick={() => window.location.reload()}>Retry connection</Button>
      </section>
    </main>
  );
}
