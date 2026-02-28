import { useState } from "react";
import { useLocation, Link } from "wouter";
import { LayoutDashboard, Calendar, FileText, Users, MoreHorizontal, Settings2, KeyRound, LogOut, Inbox, MessageSquare, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { AccessCodeDialog } from "./access-code-dialog";
import { FeedbackDialog } from "./feedback-dialog";
import { FeedbackPanelDialog } from "./feedback-panel-dialog";
import { ThemeToggle } from "./theme-toggle";
import logoImage from "@assets/m3MJU_1771476103365.png";

const PRIMARY = "#8B9E8B";

export function MobileHeader() {
  return (
    <header className="md:hidden sticky top-0 z-50 flex items-center justify-between px-4 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex items-center gap-2.5">
        <img src={logoImage} alt="LeafLog" className="w-7 h-7 rounded-md object-cover" />
        <span className="font-semibold text-sm tracking-tight">LeafLog</span>
      </div>
      <ThemeToggle />
    </header>
  );
}

export function MobileBottomNav() {
  const [location, navigate] = useLocation();
  const { user, isAdmin, isManager, logout } = useAuth();
  const { toast } = useToast();
  const [moreOpen, setMoreOpen] = useState(false);
  const [accessCodeOpen, setAccessCodeOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackPanelOpen, setFeedbackPanelOpen] = useState(false);

  const handleLogout = async () => {
    try {
      setMoreOpen(false);
      await logout();
      navigate("/login");
      toast({ title: "Logged out", description: "You have been safely signed out." });
    } catch (err: any) {
      toast({ title: "Logout failed", description: err.message, variant: "destructive" });
    }
  };

  const mainTabs = [
    { title: "Home", url: "/", icon: LayoutDashboard },
    { title: "Schedule", url: "/schedule", icon: Calendar },
    ...(isAdmin || isManager
      ? [
          { title: "Timesheets", url: "/timesheets", icon: FileText },
          { title: "Employees", url: "/employees", icon: Users },
        ]
      : []),
  ];

  const isActive = (url: string) =>
    url === "/" ? location === "/" : location.startsWith(url);

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t safe-area-bottom">
        <div className="flex items-stretch h-16 px-1">
          {mainTabs.map((tab) => {
            const active = isActive(tab.url);
            return (
              <Link
                key={tab.url}
                href={tab.url}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 rounded-xl mx-0.5 my-1 transition-colors"
                style={active ? { backgroundColor: `${PRIMARY}18` } : undefined}
                data-testid={`mobile-nav-${tab.title.toLowerCase()}`}
              >
                <tab.icon
                  className="w-5 h-5"
                  style={{ color: active ? PRIMARY : undefined }}
                />
                <span
                  className="text-[10px] font-medium"
                  style={{ color: active ? PRIMARY : undefined }}
                >
                  {tab.title}
                </span>
              </Link>
            );
          })}

          <button
            onClick={() => setMoreOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 rounded-xl mx-0.5 my-1 transition-colors text-muted-foreground"
            data-testid="mobile-nav-more"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
        {/* Safe area for devices with home indicator */}
        <div className="h-safe-bottom" />
      </nav>

      {/* More sheet */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-[60] flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMoreOpen(false)}
          />
          <div className="relative rounded-t-3xl bg-background border-t shadow-2xl">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>

            {/* User info */}
            <div className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ backgroundColor: PRIMARY, color: "#E8DCC4" }}
                >
                  {user?.username?.[0]?.toUpperCase() || "U"}
                </div>
                <div>
                  <div className="text-sm font-semibold">{user?.username}</div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {user?.role === "admin" ? "Admin" : user?.role}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setMoreOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground bg-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Menu items */}
            <div className="px-3 pb-6 space-y-0.5">
              <MoreItem
                icon={Settings2}
                label="Settings"
                onClick={() => { setMoreOpen(false); navigate("/settings"); }}
              />

              {(isAdmin || isManager) && (
                <MoreItem
                  icon={KeyRound}
                  label="Access Codes"
                  onClick={() => { setMoreOpen(false); setAccessCodeOpen(true); }}
                />
              )}

              {isAdmin && (
                <MoreItem
                  icon={Inbox}
                  label="Feedback Inbox"
                  onClick={() => { setMoreOpen(false); setFeedbackPanelOpen(true); }}
                />
              )}

              {!isAdmin && isManager && (
                <MoreItem
                  icon={MessageSquare}
                  label="Send Feedback"
                  onClick={() => { setMoreOpen(false); setFeedbackOpen(true); }}
                />
              )}

              <div className="my-2 h-px bg-border" />

              <MoreItem
                icon={LogOut}
                label="Sign Out"
                onClick={handleLogout}
                danger
              />
            </div>
          </div>
        </div>
      )}

      <AccessCodeDialog open={accessCodeOpen} onOpenChange={setAccessCodeOpen} />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <FeedbackPanelDialog open={feedbackPanelOpen} onOpenChange={setFeedbackPanelOpen} />
    </>
  );
}

function MoreItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-left active:scale-[0.98] transition-all ${
        danger
          ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
          : "text-foreground hover:bg-muted"
      }`}
    >
      <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center ${
          danger ? "bg-red-100 dark:bg-red-950/50" : "bg-muted"
        }`}
      >
        <Icon className="w-4.5 h-4.5" />
      </div>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
