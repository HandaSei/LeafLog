import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bell, CheckCheck, Clock, MessageSquare, AlertTriangle, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatDistanceToNow } from "date-fns";
import type { Notification } from "@shared/schema";

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

function NotificationList({
  notifications,
  isLoading,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  markAllPending,
}: {
  notifications: Notification[];
  isLoading: boolean;
  unreadCount: number;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  markAllPending: boolean;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <h3 className="text-sm font-semibold">Notifications</h3>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onMarkAllRead}
            disabled={markAllPending}
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="w-3 h-3 mr-1" />
            Mark all read
          </Button>
        )}
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {isLoading ? (
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
                  if (!notif.read) onMarkRead(notif.id);
                }}
                data-testid={`notification-item-${notif.id}`}
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
    </>
  );
}

export function NotificationBell() {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    enabled: open,
    refetchInterval: open ? 30000 : false,
  });

  const { data: popoverNotifications = [], isLoading: popoverLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    enabled: popoverOpen,
  });

  const { data: sheetNotifications = [], isLoading: sheetLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    enabled: sheetOpen,
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

  const unreadCount = countData?.count || 0;

  const triggerButton = (
    <Button
      variant="ghost"
      size="icon"
      className="relative h-8 w-8"
      data-testid="button-notification-bell"
    >
      <Bell className="w-4 h-4" />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-red-500 rounded-full" data-testid="badge-notification-count">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Button>
  );

  return (
    <>
      {/* Desktop: popover dropdown */}
      <div className="hidden md:block">
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0" data-testid="popover-notifications">
            <NotificationList
              notifications={popoverNotifications}
              isLoading={popoverLoading}
              unreadCount={unreadCount}
              onMarkRead={(id) => markReadMutation.mutate(id)}
              onMarkAllRead={() => markAllReadMutation.mutate()}
              markAllPending={markAllReadMutation.isPending}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Mobile: bottom sheet */}
      <div className="md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>{triggerButton}</SheetTrigger>
          <SheetContent side="bottom" className="p-0 rounded-t-xl">
            <div className="max-h-[60vh] overflow-y-auto">
              <NotificationList
                notifications={sheetNotifications}
                isLoading={sheetLoading}
                unreadCount={unreadCount}
                onMarkRead={(id) => markReadMutation.mutate(id)}
                onMarkAllRead={() => markAllReadMutation.mutate()}
                markAllPending={markAllReadMutation.isPending}
              />
            </div>
            {unreadCount > 0 && (
              <div className="px-3 py-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs w-full"
                  onClick={() => markAllReadMutation.mutate()}
                  disabled={markAllReadMutation.isPending}
                  data-testid="button-mark-all-read"
                >
                  <CheckCheck className="w-3 h-3 mr-1" />
                  Mark all read
                </Button>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
