import { useState, useEffect, lazy, Suspense } from "react";
import { useLocation, Link } from "wouter";
import { LayoutDashboard, Calendar, FileText, Users, MoreHorizontal, Settings2, KeyRound, LogOut, Inbox, MessageSquare, X, ShieldCheck, Bell, CheckCheck, Clock, AlertTriangle, UserCheck } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
const AccessCodeDialog = lazy(() => import("./access-code-dialog"));
const FeedbackDialog = lazy(() => import("./feedback-dialog"));
const FeedbackPanelDialog = lazy(() => import("./feedback-panel-dialog"));
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import type { Notification } from "@shared/schema";

const PRIMARY = "#8B9E8B";

const typeIcons: Record<string, typeof Bell> = {
  "employee-note": MessageSquare,
  "approval-needed": UserCheck,
  "employee-late": Clock,
  "early-clock-out": AlertTriangle,
};

const typeColors: Record<string, string> = {
  "employee-note": "#3B82F6",
  "approval-needed": "#F59E0B",
  "employee-late": "#EF4444",
  "early-clock-out": "#F97316",
};

export function MobileHeader() {
  return (
    <header className="md:hidden sticky top-0 z-50 flex items-center px-4 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80" />
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

  // Preload dialog chunks after initial render
  useEffect(() => {
    const t = setTimeout(() => {
      import("./access-code-dialog");
      import("./feedback-dialog");
      import("./feedback-panel-dialog");
    }, 2500);
    return () => clearTimeout(t);
  }, []);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

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

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    enabled: moreOpen || notificationsOpen,
    refetchInterval: moreOpen || notificationsOpen ? 30000 : false,
  });
  const unreadCount = countData?.count || 0;

  const { data: notifications = [], isLoading: notificationsLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    enabled: notificationsOpen,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/notifications/read-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

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

              {(isAdmin || isManager) && (
                <MoreItem
                  icon={Bell}
                  label={`Notifications${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
                  onClick={() => { setMoreOpen(false); setNotificationsOpen(true); }}
                />
              )}

              {isAdmin && (
                <MoreItem
                  icon={ShieldCheck}
                  label="Admin"
                  onClick={() => { setMoreOpen(false); navigate("/admin"); }}
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

      {/* Notifications sheet (mobile) */}
      <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <SheetContent side="bottom" className="p-0 rounded-t-xl">
          <SheetHeader className="px-3 py-2 border-b text-left">
            <SheetTitle className="text-sm font-semibold">Notifications</SheetTitle>
          </SheetHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {notificationsLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet</div>
            ) : (
              notifications.map((notif) => {
                const Icon = typeIcons[notif.type] || Bell;
                const color = typeColors[notif.type] || "#6B7280";
                return (
                  <div
                    key={notif.id}
                    className={`flex gap-3 px-3 py-2.5 border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors ${
                      !notif.read ? "bg-primary/5" : ""
                    }`}
                    onClick={() => {
                      if (!notif.read) markReadMutation.mutate(notif.id);
                    }}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: `${color}15` }}
                      >
                        <Icon className="w-3.5 h-3.5" style={{ color }} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold leading-tight">{notif.title}</p>
                        {!notif.read && (
                          <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        {notif.createdAt ? formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true }) : ""}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {unreadCount > 0 && (
            <div className="px-3 py-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs w-full"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
              >
                <CheckCheck className="w-3 h-3 mr-1" />
                Mark all read
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Suspense fallback={null}>
        <AccessCodeDialog open={accessCodeOpen} onOpenChange={setAccessCodeOpen} />
      </Suspense>
      <Suspense fallback={null}>
        <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      </Suspense>
      <Suspense fallback={null}>
        <FeedbackPanelDialog open={feedbackPanelOpen} onOpenChange={setFeedbackPanelOpen} />
      </Suspense>
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
