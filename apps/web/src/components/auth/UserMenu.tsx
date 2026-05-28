import { LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";

export function UserMenu() {
  const { user, membership, signOut } = useAuth();

  return (
    <div className="flex items-center gap-2.5">
      {membership?.role === "owner" && (
        <>
          <Link to="/import" className="text-xs font-medium text-primary hover:underline">
            Import
          </Link>
          <Link to="/owner" className="text-xs font-medium text-primary hover:underline">
            Owner view
          </Link>
        </>
      )}
      {membership && (
        <span className="hidden text-xs text-muted-foreground sm:inline">{membership.orgName}</span>
      )}
      <span className="hidden text-xs text-muted-foreground md:inline">{user?.email}</span>
      {membership && (
        <Badge variant={membership.role === "owner" ? "default" : "secondary"}>
          {membership.role}
        </Badge>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Sign out" onClick={() => signOut()}>
        <LogOut />
      </Button>
    </div>
  );
}
