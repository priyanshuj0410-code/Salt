import { Link } from "react-router-dom";
import { UserMenu } from "@/components/auth/UserMenu";

export function OwnerHome() {
  return (
    <div className="flex h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b bg-background px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">Salt</span>
          <span className="text-xs text-muted-foreground">Owner</span>
        </div>
        <UserMenu />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-xl font-semibold">Owner dashboard</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Consolidated reporting, inventory health, and staff management will live here.
          This area is restricted to the owner role.
        </p>
        <Link to="/" className="text-sm font-medium text-primary hover:underline">
          Go to billing →
        </Link>
      </main>
    </div>
  );
}
