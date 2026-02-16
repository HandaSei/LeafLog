import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/constants";

interface EmployeeAvatarProps {
  name: string;
  color: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};

export function EmployeeAvatar({ name, color, size = "md" }: EmployeeAvatarProps) {
  return (
    <Avatar className={sizeClasses[size]}>
      <AvatarFallback
        style={{ backgroundColor: color, color: "white" }}
        className="font-medium"
      >
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
