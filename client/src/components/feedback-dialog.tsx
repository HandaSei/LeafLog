import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare } from "lucide-react";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: remaining } = useQuery<{ remaining: number }>({
    queryKey: ["/api/feedback/remaining"],
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async (msg: string) => {
      const res = await apiRequest("POST", "/api/feedback", { message: msg });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback/remaining"] });
      toast({ title: "Feedback sent", description: "Thank you for your message!" });
      setMessage("");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Could not send feedback", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!message.trim()) return;
    mutation.mutate(message);
  };

  const left = remaining?.remaining ?? 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            Send Feedback
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Share suggestions, report issues, or anything you'd like us to know.
          </p>
          <Textarea
            placeholder="Write your feedback here..."
            className="resize-none min-h-[120px]"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            data-testid="input-feedback"
          />
          <p className="text-xs text-muted-foreground text-right">
            {left} message{left !== 1 ? "s" : ""} remaining today
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending || !message.trim() || left === 0}
            data-testid="button-send-feedback"
          >
            {mutation.isPending ? "Sending..." : "Send Feedback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
