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
  const displayColor = color === "#3B82F6" || !color ? "#9CA3AF" : color;
  return (
    <Avatar className={sizeClasses[size]}>
      <AvatarFallback
        style={{ backgroundColor: displayColor, color: "white" }}
        className="font-medium"
      >
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
