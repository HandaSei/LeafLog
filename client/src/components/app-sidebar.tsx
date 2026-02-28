import { useState } from "react";
import { Calendar, Users, LayoutDashboard, KeyRound, LogOut, FileText, Settings2, MessageSquare, Inbox } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { AccessCodeDialog } from "./access-code-dialog";
import { FeedbackDialog } from "./feedback-dialog";
import { FeedbackPanelDialog } from "./feedback-panel-dialog";
import logoImage from "@assets/m3MJU_1771476103365.png";

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { user, isAdmin, isManager, logout } = useAuth();
  const { toast } = useToast();
  const [accessCodeOpen, setAccessCodeOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackPanelOpen, setFeedbackPanelOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      setLocation("/login");
      toast({ title: "Logged out", description: "You have been safely signed out." });
    } catch (err: any) {
      toast({ title: "Logout failed", description: err.message, variant: "destructive" });
    }
  };

  const navItems = [
    { title: "Dashboard", url: "/", icon: LayoutDashboard },
    { title: "Schedule", url: "/schedule", icon: Calendar },
    ...(isAdmin || isManager
      ? [
          { title: "Timesheets", url: "/timesheets", icon: FileText },
          { title: "Employees", url: "/employees", icon: Users },
          { title: "Settings", url: "/settings", icon: Settings2 },
        ]
      : []),
  ];

  return (
    <>
      <Sidebar>
        <SidebarHeader className="p-4">
          <div className="flex items-center gap-3">
            <img
              src={logoImage}
              alt="LeafLog"
              className="w-9 h-9 rounded-md object-cover"
              data-testid="img-sidebar-logo"
            />
            <h1 className="text-sm font-semibold tracking-tight">LeafLog</h1>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const isActive = location === item.url ||
                    (item.url !== "/" && location.startsWith(item.url));
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        data-testid={`nav-${item.title.toLowerCase()}`}
                      >
                        <Link href={item.url}>
                          <item.icon className="w-4 h-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {(isAdmin || isManager) && (
            <SidebarGroup>
              <SidebarGroupLabel>Management</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => setAccessCodeOpen(true)}
                      data-testid="nav-access-codes"
                    >
                      <KeyRound className="w-4 h-4" />
                      <span>Access Codes</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter className="p-3">
          <div className="space-y-2">
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-xs text-muted-foreground"
                onClick={() => setFeedbackPanelOpen(true)}
                data-testid="button-feedback-inbox"
              >
                <Inbox className="w-3.5 h-3.5 mr-2" />
                Feedback Inbox
              </Button>
            )}
            {!isAdmin && (isManager) && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-xs text-muted-foreground"
                onClick={() => setFeedbackOpen(true)}
                data-testid="button-send-feedback"
              >
                <MessageSquare className="w-3.5 h-3.5 mr-2" />
                Send Feedback
              </Button>
            )}
            <div className="flex items-center gap-2 px-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium"
                style={{ backgroundColor: "#8B9E8B", color: "#E8DCC4" }}
              >
                {user?.username?.[0]?.toUpperCase() || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{user?.username}</div>
                <div className="text-[10px] text-muted-foreground capitalize">{user?.role === "admin" ? "Admin" : user?.role}</div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs text-muted-foreground"
              onClick={handleLogout}
              data-testid="button-logout"
            >
              <LogOut className="w-3.5 h-3.5 mr-2" />
              Sign Out
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <AccessCodeDialog open={accessCodeOpen} onOpenChange={setAccessCodeOpen} />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <FeedbackPanelDialog open={feedbackPanelOpen} onOpenChange={setFeedbackPanelOpen} />
    </>
  );
}
