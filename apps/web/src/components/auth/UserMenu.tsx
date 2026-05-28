import { LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";

export function UserMenu() {
  const { user, profile, signOut } = useAuth();

  return (
    <div className="flex items-center gap-2.5">
      {profile?.role === "owner" && (
        <Link to="/owner" className="text-xs font-medium text-primary hover:underline">
          Owner view
        </Link>
      )}
      <span className="hidden text-xs text-muted-foreground sm:inline">{user?.email}</span>
      {profile && (
        <Badge variant={profile.role === "owner" ? "default" : "secondary"}>
          {profile.role}
        </Badge>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Sign out" onClick={() => signOut()}>
        <LogOut />
      </Button>
    </div>
  );
}
