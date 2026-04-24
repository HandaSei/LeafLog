import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, User, Mail } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface FeedbackEntry {
  id: number;
  accountId: number;
  message: string;
  createdAt: string;
  username: string;
  email: string | null;
}

interface FeedbackPanelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackPanelDialog({ open, onOpenChange }: FeedbackPanelDialogProps) {
  const { data: entries = [], isLoading } = useQuery<FeedbackEntry[]>({
    queryKey: ["/api/feedback"],
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            Feedback Inbox
            {entries.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">{entries.length}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <MessageSquare className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">No feedback received yet.</p>
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="p-3 rounded-lg border bg-muted/20 space-y-2"
                data-testid={`feedback-item-${entry.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <User className="w-3 h-3" />
                    <span className="font-medium text-foreground">{entry.username}</span>
                    {entry.email && (
                      <>
                        <Mail className="w-3 h-3 ml-1" />
                        <span>{entry.email}</span>
                      </>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{entry.message}</p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
